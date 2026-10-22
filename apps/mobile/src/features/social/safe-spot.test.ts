import { memoryStore, nth } from '../location/test-support';
import {
  clearSpot,
  forgetSpotsOf,
  keepSpot,
  loadSpots,
  openSpot,
  resetSpot,
  type SafeSpot,
  SPOT_KEEP_MS,
  SPOTS_KEY,
  spotBounds,
  spotOf,
  showSpot,
  spotShape,
  useSafeSpot,
} from './safe-spot';

const NOW = 1_800_000_000_000;
const HOUR = 60 * 60_000;
const circleId = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';

const spotOfId = (id: string, overrides: Partial<SafeSpot> = {}): SafeSpot => ({
  id,
  circleId,
  name: 'Ayşe',
  lat: 41.025_6,
  lng: 28.974_2,
  acc: 8,
  bat: 45,
  ts: NOW,
  ...overrides,
});
const idOf = (n: number) => `${'A'.repeat(21 - String(n).length)}${String(n)}A`.slice(0, 22);

beforeEach(() => {
  resetSpot();
});

describe('the places of a person no circle is shared with any more', () => {
  it('go from the vault and from the map, and only theirs', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1), { userId: 'ayse' }), NOW);
    keepSpot(store, spotOfId(idOf(2), { userId: 'bora' }), NOW);
    // A place kept by an older version names nobody: it is a day old at most and ages out.
    keepSpot(store, spotOfId(idOf(3)), NOW);
    showSpot(spotOfId(idOf(1), { userId: 'ayse' }));

    forgetSpotsOf(store, 'ayse', NOW);

    expect(loadSpots(store, NOW).map((spot) => spot.id)).toEqual([idOf(2), idOf(3)]);
    expect(useSafeSpot.getState().spot).toBeNull();

    // Someone else's place on the map stays.
    showSpot(spotOfId(idOf(2), { userId: 'bora' }));
    forgetSpotsOf(store, 'ayse', NOW);
    expect(useSafeSpot.getState().spot?.id).toBe(idOf(2));

    // Bora's go as well; the one that names nobody is not anyone's to forget.
    forgetSpotsOf(store, 'bora', NOW);
    expect(loadSpots(store, NOW).map((spot) => spot.id)).toEqual([idOf(3)]);
  });
});

describe('the places of "Güvendeyim" kept on the phone (docs/ADR/0029 §5)', () => {
  it('are kept for a day after the message was made, then deleted from the vault', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1)), NOW);
    expect(spotOf(store, idOf(1), NOW + HOUR)).toEqual(spotOfId(idOf(1)));
    expect(spotOf(store, idOf(1), NOW + 23 * HOUR)).not.toBeNull();
    // To the millisecond: a day is a day.
    expect(loadSpots(store, NOW + SPOT_KEEP_MS)).toHaveLength(1);
    expect(store.get(SPOTS_KEY)).toBeDefined();

    expect(loadSpots(store, NOW + SPOT_KEEP_MS + 1)).toEqual([]);
    // Deleted, not only left unshown: the vault has nothing of it any more.
    expect(store.get(SPOTS_KEY)).toBeUndefined();
    expect(store.keys()).toEqual([]);
  });

  it('forget the old ones whenever a new one comes, and keep the rest', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1), { ts: NOW }), NOW);
    keepSpot(store, spotOfId(idOf(2), { ts: NOW + 20 * HOUR }), NOW + 20 * HOUR);
    keepSpot(store, spotOfId(idOf(3), { ts: NOW + 30 * HOUR }), NOW + 30 * HOUR);
    expect(loadSpots(store, NOW + 30 * HOUR).map((spot) => spot.id)).toEqual([idOf(2), idOf(3)]);
    expect(JSON.stringify(store.get(SPOTS_KEY))).not.toContain(idOf(1));
  });

  it('are not kept at all when the message is already a day old', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1), { ts: NOW - SPOT_KEEP_MS - 1 }), NOW);
    expect(store.keys()).toEqual([]);
  });

  it('are one per message, the newest 20, and a damaged copy is cleared', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1), { lat: 1 }), NOW);
    keepSpot(store, spotOfId(idOf(1), { lat: 2 }), NOW);
    expect(loadSpots(store, NOW)).toHaveLength(1);
    expect(nth(loadSpots(store, NOW)).lat).toBe(2);
    for (let n = 2; n <= 30; n += 1) keepSpot(store, spotOfId(idOf(n)), NOW);
    const kept = loadSpots(store, NOW);
    expect(kept).toHaveLength(20);
    expect(nth(kept, 19).id).toBe(idOf(30));

    store.set(SPOTS_KEY, '{ not json');
    expect(loadSpots(store, NOW)).toEqual([]);
    expect(store.get(SPOTS_KEY)).toBeUndefined();
    store.set(SPOTS_KEY, JSON.stringify([{ id: 'x' }]));
    expect(loadSpots(store, NOW)).toEqual([]);
    expect(store.get(SPOTS_KEY)).toBeUndefined();
  });
});

describe('showing a place on the map', () => {
  it('draws a dot for a place the phone knew well and a circle for a coarse one', () => {
    expect(spotShape(8)).toBe('dot');
    expect(spotShape(100)).toBe('dot');
    expect(spotShape(101)).toBe('circle');
    // A neighbourhood cell and a city cell (707 m and 7 km): a circle with that accuracy.
    expect(spotShape(708)).toBe('circle');
    expect(spotShape(7_072)).toBe('circle');
  });

  it('looks at the circle whole, or at a street round a dot', () => {
    const dot = spotBounds({ lat: 41, lng: 29, acc: 8 });
    const [west, south, east, north] = dot;
    expect(west).toBeLessThan(29);
    expect(east).toBeGreaterThan(29);
    expect(south).toBeLessThan(41);
    expect(north).toBeGreaterThan(41);
    // At least about 150 m each way: 150 m is 0.00135 degrees of latitude.
    expect(north - 41).toBeGreaterThan(0.0013);
    expect(north - 41).toBeLessThan(0.0015);
    // A coarse cell's radius (~700 m) is shown whole.
    const cell = spotBounds({ lat: 41, lng: 29, acc: 708 });
    expect(cell[3] - 41).toBeGreaterThan(0.0063);
    expect(cell[3] - 41).toBeLessThan(0.0065);
    // Near the pole and the dateline it stays on the globe.
    const edge = spotBounds({ lat: 89.9999, lng: 179.9999, acc: 7_072 });
    expect(edge[2]).toBeLessThanOrEqual(180);
    expect(edge[3]).toBeLessThanOrEqual(90);
  });

  it('is asked for by a tapped notification: the place is found by the message, once, until a tap on the map', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1)), NOW);
    expect(useSafeSpot.getState()).toEqual({ spot: null, request: 0 });

    expect(openSpot(store, idOf(1), NOW + HOUR)).toBe(true);
    expect(useSafeSpot.getState().spot).toEqual(spotOfId(idOf(1)));
    expect(useSafeSpot.getState().request).toBe(1);
    // Asked again (the same notification, another tap): the map is told again.
    expect(openSpot(store, idOf(1), NOW + HOUR)).toBe(true);
    expect(useSafeSpot.getState().request).toBe(2);

    clearSpot();
    expect(useSafeSpot.getState().spot).toBeNull();
  });

  it('is not shown when the place is gone (a day old) or was never kept: the caller opens the circle', () => {
    const store = memoryStore();
    keepSpot(store, spotOfId(idOf(1)), NOW);
    expect(openSpot(store, idOf(2), NOW)).toBe(false);
    expect(openSpot(store, idOf(1), NOW + SPOT_KEEP_MS + 1)).toBe(false);
    expect(useSafeSpot.getState()).toEqual({ spot: null, request: 0 });
  });
});
