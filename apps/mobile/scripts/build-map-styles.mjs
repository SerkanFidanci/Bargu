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
  dark: {
    ...namedFlavor('dark'),
    background: '#0D0D12',
    earth: '#15151B',
    water: '#18263A',
    park_a: '#17211C',
    park_b: '#1B2A20',
    wood_a: '#17211C',
    wood_b: '#1B2A20',
    buildings: '#1F1F27',
  },
};

for (const [name, flavor] of Object.entries(flavors)) {
  const style = {
    version: 8,
    name: `bargu-${name}`,
    sources: {
      [SOURCE]: {
        type: 'vector',
        url: `pmtiles://${MAP_URL}/tiles/turkey.pmtiles`,
        attribution: ATTRIBUTION,
      },
    },
    glyphs: `${MAP_URL}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${MAP_URL}/sprites/v4/${name}`,
    layers: layers(SOURCE, flavor, { lang: 'tr' }),
  };
  const file = new URL(`../src/features/map/styles/${name}.json`, import.meta.url);
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fixed output files inside this repo (styles/<light|dark>.json)
  writeFileSync(file, `${JSON.stringify(style)}\n`);
  process.stdout.write(`wrote ${file.pathname} (${style.layers.length} layers)\n`);
}
