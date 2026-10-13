jest.mock('@/config/env', () => ({ env: { mapUrl: 'https://unused.example.test' } }));

import dark from './styles/dark.json';
import light from './styles/light.json';
import { mapStyle } from './style';

const MAP_URL = 'https://maps.example.test/map';

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
});
