import type { LocPayload } from '@bargu/schemas';

import type { Place } from '../places/place-model';
import { HOME_ETA, homeEta, homesOf } from './home-eta';

const NOW = 1_800_000_000_000;
// Home 2 km north of where they are.
const home: Place = {
  id: 'p1',
  circleId: 'c1',
  version: 1,
  name: 'Bizim ev',
  emoji: '🏠',
  lat: 41.018,
  lng: 29.0,
  radius: 100,
  ts: NOW,
};
const at = (overrides: Partial<LocPayload> = {}): LocPayload => ({
  kind: 'loc',
  lat: 41.0,
  lng: 29.0,
  acc: 8,
  bat: 70,
  chg: false,
  spd: 8,
  hdg: 5,
  ts: NOW,
  ...overrides,
});

describe('"Eve yaklaşık 12 dk" (Ö12)', () => {
  it('says how long, roughly, for someone on the move toward a home', () => {
    const eta = homeEta(at(), [home], NOW);
    expect(eta?.place).toBe(home);
    expect(eta?.minutes).toBeGreaterThan(1);
    expect(eta?.minutes).toBeLessThan(30);
  });

  it('says nothing standing, staying, heading elsewhere, home already, old or coarse', () => {
    expect(homeEta(at({ spd: 0.2 }), [home], NOW)).toBeNull();
    expect(homeEta(at({ since: NOW - 10 * 60_000 }), [home], NOW)).toBeNull();
    expect(homeEta(at({ hdg: 180 }), [home], NOW)).toBeNull();
    expect(homeEta(at({ lat: 41.018 }), [home], NOW)).toBeNull();
    expect(homeEta(at({ ts: NOW - HOME_ETA.freshMs - 1 }), [home], NOW)).toBeNull();
    expect(homeEta(at({ acc: 708 }), [home], NOW)).toBeNull();
    // Dated ahead: a wrong clock, not a fresh location (QA-42).
    expect(homeEta(at({ ts: NOW + 5 * 60_000 }), [home], NOW)).toBeNull();
    // No speed known (a location from a coarse circle carries none).
    expect(homeEta({ ...at(), spd: undefined }, [home], NOW)).toBeNull();
    expect(homeEta(at(), [], NOW)).toBeNull();
  });

  it('takes the houses of circles they share, and no other place', () => {
    const places = {
      p1: home,
      p2: { ...home, id: 'p2', emoji: '☕' },
      p3: { ...home, id: 'p3', circleId: 'c2' },
    };
    const member = (userId: string) => ({
      userId,
      role: 'member' as const,
      status: 'active' as const,
      username: null,
      displayName: null,
      avatar: null,
      device: null,
    });
    const circle = {
      id: 'c1',
      kind: 'family' as const,
      name: 'Aile',
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member' as const,
      myStatus: 'active' as const,
      members: [member('me'), member('ayse')],
    };
    expect(homesOf(places, [circle], 'ayse')).toEqual([home]);
    expect(homesOf(places, [circle], 'cem')).toEqual([]);
  });
});
