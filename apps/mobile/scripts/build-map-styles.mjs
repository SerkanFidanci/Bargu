// Generates the MapLibre styles (light/dark) from the Protomaps basemap layers with Bargu colours.
// Run after changing colours or upgrading @protomaps/basemaps:
//   node scripts/build-map-styles.mjs
// The output is committed; the app fills in the map server URL at runtime (src/features/map).
import { writeFileSync } from 'node:fs';
import process from 'node:process';

import { layers, namedFlavor } from '@protomaps/basemaps';

/** Placeholder for the self-hosted map server (tiles, fonts, sprites); see src/features/map/style.ts. */
const MAP_URL = '__MAP_URL__';
const SOURCE = 'protomaps';
const ATTRIBUTION = '© OpenStreetMap';

// A second, low-detail source under the Turkey one: the same Protomaps planet build cut at zoom 6
// (infra/staging/apply-pending.sh, 45 MB), so the world outside Turkey is not empty. Beyond zoom 6
// MapLibre overzooms it (the source says maxzoom 6). Turkey keeps its own layers on top, untouched.
// If the file is not on the server the source fails to load and its layers draw nothing; the map
// then looks as it did before (docs/ADR/0008, "Dünya katmanı").
const WORLD_SOURCE = 'world';
const WORLD_MAXZOOM = 6;
const WORLD_ID_PREFIX = 'world_';
// Only what reads at a glance when zoomed out: land, water, borders, the big names, and at zoom 5-6
// the motorways and major roads. Parks, buildings, pois and the rest of the roads would only add
// layers (and noise) at this level of detail.
const WORLD_LAYER_IDS = [
  'earth',
  'landcover',
  'water',
  'roads_major',
  'roads_highway',
  'boundaries_country',
  'boundaries',
  'water_label_ocean',
  'places_region',
  'places_locality',
  'places_country',
];
// Roads: only from zoom 5 and only until zoom 7 (a layer's maxzoom is exclusive, so 5 to 6.99).
// Past that the world file is overzoomed and its roads would be coarse, wobbly lines. They fade
// out over zoom 6 to 7 instead of vanishing at once. Casings, links, bridges, tunnels, minor roads
// and rail are not drawn. Major roads are 0 px wide below zoom 6 in the basemap's own style (it
// leaves them to the next zoom levels), so they get a thin line of their own here; motorways keep
// the basemap's width (about 0.5 px at zoom 5, 1.1 px at zoom 6). Colour: the road colour on the
// dark land; on the light land, where roads are white (invisible at this width), the colour of the
// road casings: a light grey that shows without getting loud.
const WORLD_ROAD_MINZOOM = 5;
const WORLD_ROAD_MAXZOOM = 7;
const WORLD_ROAD_FADE = ['interpolate', ['linear'], ['zoom'], 6, 1, 7, 0];
const WORLD_OVERRIDES = {
  roads_major: {
    paint: {
      'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.3, 7, 0.7],
      'line-opacity': WORLD_ROAD_FADE,
    },
    minzoom: WORLD_ROAD_MINZOOM,
    maxzoom: WORLD_ROAD_MAXZOOM,
  },
  roads_highway: {
    paint: { 'line-opacity': WORLD_ROAD_FADE },
    minzoom: WORLD_ROAD_MINZOOM,
    maxzoom: WORLD_ROAD_MAXZOOM,
  },
};

/**
 * The world layers, in the basemap's own drawing order, under ids of their own. The basemap's
 * background is not repeated: the Turkey style draws it once, below everything.
 */
function worldLayers(flavor, roadColors) {
  const wanted = new Set(WORLD_LAYER_IDS);
  const found = layers(WORLD_SOURCE, flavor, { lang: 'tr' })
    .filter((layer) => wanted.has(layer.id))
    .map((layer) => {
      const { paint, ...rest } = WORLD_OVERRIDES[layer.id] ?? {};
      const color = roadColors[layer.id];
      return {
        ...layer,
        ...rest,
        id: `${WORLD_ID_PREFIX}${layer.id}`,
        ...(paint === undefined
          ? {}
          : {
              paint: {
                ...layer.paint,
                ...paint,
                ...(color === undefined ? {} : { 'line-color': color }),
              },
            }),
      };
    });
  if (found.length !== wanted.size) {
    throw new Error('@protomaps/basemaps no longer has every world layer; update WORLD_LAYER_IDS');
  }
  return found;
}

// Quiet, warm base so avatars (saturated palette) stand out; water and parks stay recognisable.
const flavors = {
  light: {
    ...namedFlavor('light'),
    background: '#EDEAE4',
    earth: '#F3F1EC',
    water: '#A9D3E6',
    park_a: '#DCE8D8',
    park_b: '#C4DDBE',
    wood_a: '#DCE8D8',
    wood_b: '#C4DDBE',
    buildings: '#E4E0D8',
  },
  // Dusk rather than black: slate land, clear blue water, readable roads and labels.
  dark: (() => {
    const halo = '#2B3040';
    const casing = '#2A2F3C';
    const road = { minor: '#4A5163', major: '#5A6277', highway: '#6B7389' };
    return {
      ...namedFlavor('dark'),
      background: halo,
      earth: '#323848',
      water: '#2D4E73',
      park_a: '#2F4A40',
      park_b: '#33554A',
      wood_a: '#30473E',
      wood_b: '#30473E',
      scrub_a: '#334641',
      scrub_b: '#334641',
      sand: '#3A3D45',
      beach: '#3E414A',
      glacier: '#3A3F4C',
      hospital: '#3A3540',
      industrial: '#363B48',
      school: '#3A3842',
      pedestrian: '#383D4B',
      aerodrome: '#353A48',
      runway: '#454B5B',
      pier: '#454B5B',
      zoo: '#344640',
      military: '#383A44',
      buildings: '#3D4354',
      railway: '#5A6070',
      boundaries: '#7A8296',
      other: road.minor,
      minor_service: road.minor,
      minor_a: road.minor,
      minor_b: road.minor,
      link: road.major,
      major: road.major,
      highway: road.highway,
      bridges_other: road.minor,
      bridges_minor: road.minor,
      bridges_link: road.major,
      bridges_major: road.major,
      bridges_highway: road.highway,
      tunnel_other: '#3F4555',
      tunnel_minor: '#3F4555',
      tunnel_link: '#3F4555',
      tunnel_major: '#3F4555',
      tunnel_highway: '#3F4555',
      minor_service_casing: casing,
      minor_casing: casing,
      link_casing: casing,
      major_casing_late: casing,
      highway_casing_late: casing,
      major_casing_early: casing,
      highway_casing_early: casing,
      bridges_other_casing: casing,
      bridges_minor_casing: casing,
      bridges_link_casing: casing,
      bridges_major_casing: casing,
      bridges_highway_casing: casing,
      tunnel_other_casing: casing,
      tunnel_minor_casing: casing,
      tunnel_link_casing: casing,
      tunnel_major_casing: casing,
      tunnel_highway_casing: casing,
      roads_label_minor: '#9AA1B2',
      roads_label_minor_halo: halo,
      roads_label_major: '#AEB4C4',
      roads_label_major_halo: halo,
      ocean_label: '#8FB4DA',
      subplace_label: '#A7ADBC',
      subplace_label_halo: halo,
      city_label: '#E4E6EC',
      city_label_halo: halo,
      state_label: '#8D93A3',
      state_label_halo: halo,
      country_label: '#B8BDCA',
      address_label: '#9AA1B2',
      address_label_halo: halo,
      landcover: {
        grassland: 'rgba(52, 72, 62, 1)',
        barren: 'rgba(62, 62, 66, 1)',
        urban_area: 'rgba(56, 61, 76, 1)',
        farmland: 'rgba(54, 68, 60, 1)',
        glacier: 'rgba(66, 71, 84, 1)',
        scrub: 'rgba(56, 70, 64, 1)',
        forest: 'rgba(47, 74, 64, 1)',
      },
    };
  })(),
};

for (const [name, flavor] of Object.entries(flavors)) {
  // The Turkey layers exactly as before: the background first (it paints everything), then the
  // world, then the rest of Turkey on top.
  const [background, ...turkey] = layers(SOURCE, flavor, { lang: 'tr' });
  const roadColors =
    name === 'light'
      ? { roads_highway: flavor.highway_casing_early, roads_major: flavor.major_casing_early }
      : { roads_highway: flavor.highway, roads_major: flavor.major };
  const style = {
    version: 8,
    name: `bargu-${name}`,
    sources: {
      [SOURCE]: {
        type: 'vector',
        url: `pmtiles://${MAP_URL}/tiles/turkey.pmtiles`,
        attribution: ATTRIBUTION,
      },
      [WORLD_SOURCE]: {
        type: 'vector',
        url: `pmtiles://${MAP_URL}/tiles/world.pmtiles`,
        maxzoom: WORLD_MAXZOOM,
        attribution: ATTRIBUTION,
      },
    },
    glyphs: `${MAP_URL}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${MAP_URL}/sprites/v4/${name}`,
    layers: [background, ...worldLayers(flavor, roadColors), ...turkey],
  };
  const file = new URL(`../src/features/map/styles/${name}.json`, import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed output files inside this repo (styles/<light|dark>.json)
  writeFileSync(file, `${JSON.stringify(style)}\n`);
  process.stdout.write(`wrote ${file.pathname} (${style.layers.length} layers)\n`);
}
