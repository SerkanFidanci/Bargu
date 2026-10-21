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
// Only what reads at a glance when zoomed out: land, water, borders, and the big names. Roads,
// parks, buildings and pois would only add layers (and noise) at this level of detail.
const WORLD_LAYER_IDS = [
  'earth',
  'landcover',
  'water',
  'boundaries_country',
  'boundaries',
  'water_label_ocean',
  'places_region',
  'places_locality',
  'places_country',
];

/**
 * The world layers, in the basemap's own drawing order, under ids of their own. The basemap's
 * background is not repeated: the Turkey style draws it once, below everything.
 */
function worldLayers(flavor) {
  const wanted = new Set(WORLD_LAYER_IDS);
  const found = layers(WORLD_SOURCE, flavor, { lang: 'tr' })
    .filter((layer) => wanted.has(layer.id))
    .map((layer) => ({ ...layer, id: `${WORLD_ID_PREFIX}${layer.id}` }));
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
    layers: [background, ...worldLayers(flavor), ...turkey],
  };
  const file = new URL(`../src/features/map/styles/${name}.json`, import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed output files inside this repo (styles/<light|dark>.json)
  writeFileSync(file, `${JSON.stringify(style)}\n`);
  process.stdout.write(`wrote ${file.pathname} (${style.layers.length} layers)\n`);
}
