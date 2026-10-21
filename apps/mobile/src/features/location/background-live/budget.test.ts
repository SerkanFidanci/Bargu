import { memoryStore } from '../test-support';
import {
  BACKGROUND_LIVE_CAP_MS,
  BACKGROUND_LIVE_WINDOW_MS,
  fits,
  loadStretches,
  pruned,
  saveStretches,
  type Stretch,
  usedBetween,
} from './budget';

const T = 1_800_000_000_000;
const MINUTE = 60_000;

describe("the phone's own allowance for background live mode (docs/ADR/0028 step 3)", () => {
  it('is 15 minutes in any rolling hour', () => {
    expect(BACKGROUND_LIVE_CAP_MS).toBe(15 * MINUTE);
    expect(BACKGROUND_LIVE_WINDOW_MS).toBe(60 * MINUTE);
  });

  it('counts only the time inside the hour', () => {
    const stretches: Stretch[] = [
      [T - 90 * MINUTE, T - 70 * MINUTE],
      [T - 70 * MINUTE, T - 58 * MINUTE],
      [T - 10 * MINUTE, T - 8 * MINUTE],
    ];
    expect(usedBetween(stretches, T - BACKGROUND_LIVE_WINDOW_MS, T)).toBe(2 * MINUTE + 2 * MINUTE);
    expect(pruned(stretches, T)).toEqual(stretches.slice(1));
  });

  it('lets seven two-minute windows in an hour and refuses the eighth', () => {
    const stretches: Stretch[] = [];
    for (let index = 0; index < 7; index += 1) {
      const from = T + index * 4 * MINUTE;
      const to = from + 2 * MINUTE;
      expect(fits(stretches, from, to)).toBe(true);
      stretches.push([from, to]);
    }
    // 14 minutes used; a 2-minute window would make 16.
    const from = T + 28 * MINUTE;
    expect(fits(stretches, from, from + 2 * MINUTE)).toBe(false);
    // A shorter piece that makes exactly 15 still fits.
    expect(fits(stretches, from, from + MINUTE)).toBe(true);
    // An hour after the first window it has room again.
    const later = T + 62 * MINUTE;
    expect(fits(stretches, later, later + 2 * MINUTE)).toBe(true);
  });

  it('can be set lower (the constant is the default, not a limit of the code)', () => {
    expect(fits([], T, T + 2 * MINUTE, MINUTE)).toBe(false);
    expect(fits([], T, T + MINUTE, MINUTE)).toBe(true);
  });

  it('is kept in the vault, and a damaged copy counts as nothing used', () => {
    const store = memoryStore();
    expect(loadStretches(store)).toEqual([]);
    saveStretches(store, [[T, T + 2 * MINUTE]]);
    expect(loadStretches(store)).toEqual([[T, T + 2 * MINUTE]]);
    store.set('bglive:budget:v1', '{nonsense');
    expect(loadStretches(store)).toEqual([]);
    store.set('bglive:budget:v1', JSON.stringify([['a', 'b']]));
    expect(loadStretches(store)).toEqual([]);
  });
});
