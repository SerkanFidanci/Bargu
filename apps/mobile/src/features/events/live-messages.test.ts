import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { LIVE_MESSAGES } from './socket-transport';

/**
 * Every live message the location session handles must be one the socket listens to. `place` and
 * `history` were handled since Faz 7 but never listened to, so an open app missed arrivals,
 * "geç kalıyorum", "Geldim" and history updates (the server pushes only to closed apps).
 */
describe('live messages', () => {
  it('listens to every message the location session handles', () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- this app's own source file, a fixed path under src
    const source = readFileSync(join(__dirname, '../location/location-session.ts'), 'utf8');
    const handled = [...source.matchAll(/name === '([a-z.]+)'/g)].map((match) => match[1]);
    expect(handled.length).toBeGreaterThan(5);
    const listened: readonly string[] = LIVE_MESSAGES;
    expect(handled.filter((name) => !listened.includes(name ?? ''))).toEqual([]);
  });

  it('listens to arrivals and history updates', () => {
    expect(LIVE_MESSAGES).toEqual(expect.arrayContaining(['place', 'history']));
  });
});
