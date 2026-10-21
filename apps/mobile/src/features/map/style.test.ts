jest.mock('@/config/env', () => ({ env: { mapUrl: 'https://unused.example.test' } }));

import { PLACE_LAYERS } from './place-name';
import dark from './styles/dark.json';
import light from './styles/light.json';
import { mapStyle } from './style';

const MAP_URL = 'https://maps.example.test/map';

type Layer = ReturnType<typeof mapStyle>['layers'][number];

/** The source a layer reads from (the background layer has none). */
function sourceOf(layer: Layer): string | undefined {
  return 'source' in layer ? layer.source : undefined;
}

/** The few layer fields the road checks read (a style layer as plain JSON). */
interface RoadLayer {
  id: string;
  source?: string;
  'source-layer'?: string;
  minzoom?: number;
  maxzoom?: number;
  filter?: unknown;
  paint?: Record<string, unknown>;
}

/** Font stacks and sprite icons a set of layers asks the map server for. */
function assetsOf(layers: readonly Layer[]): string[] {
  const json = JSON.stringify(layers);
  return [
    ...(json.match(/"Noto Sans [^"]*"/g) ?? []),
    ...(json.match(/"(capital|townspot)"/g) ?? []),
  ];
}

/** Every URL a style can make the phone fetch: sources, glyphs, sprite. */
function urls(style: object): string[] {
  const found: string[] = [];
  JSON.stringify(style, (_key, value: unknown) => {
    if (typeof value === 'string' && /^(pmtiles:\/\/)?[a-z]+:\/\//.test(value)) found.push(value);
    return value;
  });
  return found;
}

describe.each([
  ['light', light],
  ['dark', dark],
] as const)('%s map style', (scheme, template) => {
  it('talks only to our own map server (no third party sees the viewport)', () => {
    const style = mapStyle(scheme, MAP_URL);
    const fetched = [...urls(style), style.glyphs, style.sprite].filter(
      (value): value is string => typeof value === 'string',
    );
    expect(fetched.length).toBeGreaterThan(0);
    for (const url of fetched) {
      expect(url.replace(/^pmtiles:\/\//, '').startsWith(MAP_URL)).toBe(true);
    }
  });

  it('labels places in Turkish and credits OpenStreetMap', () => {
    const json = JSON.stringify(template);
    expect(json).toContain('name:tr');
    expect(json).toContain('OpenStreetMap');
  });

  it('leaves no placeholder behind', () => {
    expect(JSON.stringify(mapStyle(scheme, MAP_URL))).not.toContain('__MAP_URL__');
  });

  it('reads Turkey in full detail and the world at low detail, both from our server', () => {
    const { sources } = mapStyle(scheme, MAP_URL);
    expect(Object.keys(sources).sort()).toEqual(['protomaps', 'world']);
    expect(sources.protomaps).toMatchObject({
      type: 'vector',
      url: `pmtiles://${MAP_URL}/tiles/turkey.pmtiles`,
    });
    // maxzoom 6: the file stops there, MapLibre overzooms it beyond (not an empty map).
    expect(sources.world).toMatchObject({
      type: 'vector',
      url: `pmtiles://${MAP_URL}/tiles/world.pmtiles`,
      maxzoom: 6,
    });
  });

  it('draws the world under Turkey: background, then world, then every Turkey layer', () => {
    const { layers } = mapStyle(scheme, MAP_URL);
    const world = layers.filter((layer) => sourceOf(layer) === 'world');
    expect(world.length).toBeGreaterThan(0);
    // The one background paints everything; the world sits right above it.
    expect(layers[0]?.type).toBe('background');
    expect(layers.slice(1, 1 + world.length)).toEqual(world);
    // Nothing from Turkey comes before a world layer, and the world adds no second background.
    expect(world.some((layer) => layer.type === 'background')).toBe(false);
    expect(new Set(layers.map((layer) => layer.id)).size).toBe(layers.length);
  });

  it('keeps Turkey as it was: its layers read only Turkey, with their own ids', () => {
    const { layers } = mapStyle(scheme, MAP_URL);
    const turkey = layers.filter((layer) => sourceOf(layer) !== 'world');
    expect(turkey.length).toBeGreaterThan(60);
    for (const layer of turkey) {
      expect(layer.id.startsWith('world_')).toBe(false);
      if (layer.type !== 'background') expect(sourceOf(layer)).toBe('protomaps');
    }
    // The place-name lookup (queryRenderedFeatures) names Turkey layers; they must still exist.
    for (const id of PLACE_LAYERS) expect(turkey.map((layer) => layer.id)).toContain(id);
    // The world layers cannot be mistaken for them.
    const world = layers.filter((layer) => sourceOf(layer) === 'world');
    for (const layer of world) expect(PLACE_LAYERS).not.toContain(layer.id);
  });

  it('labels the world with the same fonts and icons as Turkey (nothing new to install)', () => {
    const { layers } = mapStyle(scheme, MAP_URL);
    const world = assetsOf(layers.filter((layer) => sourceOf(layer) === 'world'));
    const turkey = new Set(assetsOf(layers.filter((layer) => sourceOf(layer) === 'protomaps')));
    expect(world.length).toBeGreaterThan(0);
    for (const asset of world) expect(turkey.has(asset)).toBe(true);
  });

  it('draws only motorways and major roads in the world, at zoom 5 to 7, above the water', () => {
    const layers = mapStyle(scheme, MAP_URL).layers as unknown as RoadLayer[];
    const ids = layers.map((layer) => layer.id);
    const roads = layers.filter(
      (layer) => layer.source === 'world' && layer['source-layer'] === 'roads',
    );
    // Not casings, links, bridges, tunnels, minor roads or rail.
    expect(roads.map((layer) => layer.id)).toEqual(['world_roads_major', 'world_roads_highway']);
    const [major, highway] = roads;
    expect(JSON.stringify(major?.filter)).toContain('"kind","major_road"');
    expect(JSON.stringify(highway?.filter)).toContain('"kind","highway"');
    for (const road of roads) {
      expect(JSON.stringify(road.filter)).toContain('["!has","is_bridge"]');
      expect(JSON.stringify(road.filter)).toContain('["!has","is_tunnel"]');
      // A layer's maxzoom is exclusive: 7 means drawn up to zoom 6.99, never on the overzoomed
      // (coarse) tiles beyond; it fades out over zoom 6 to 7.
      expect(road.minzoom).toBe(5);
      expect(road.maxzoom).toBe(7);
      expect(JSON.stringify(road.paint?.['line-opacity'])).toBe(
        '["interpolate",["linear"],["zoom"],6,1,7,0]',
      );
    }
    // Above the world's water, below its borders and (as for every world layer) below Turkey.
    expect(ids.indexOf('world_water')).toBeLessThan(ids.indexOf('world_roads_major'));
    expect(ids.indexOf('world_roads_highway')).toBeLessThan(
      ids.indexOf('world_boundaries_country'),
    );
    expect(ids.indexOf('world_roads_highway')).toBeLessThan(ids.indexOf('earth'));
  });
});
