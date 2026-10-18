import { filterFix, FIX_RULES, type FilterState, freshFilter } from './fix-filter';
import type { Fix } from './send';
import { GALATA, moved } from './test-support';

const START = 1_800_000_000_000;

/** A fix `metres` north of Galata, measured `ms` after the start, with this accuracy. */
const at = (ms: number, metres = 0, acc = 8): Fix => ({
  ...moved(GALATA, metres, START + ms),
  acc,
});

/** Feeds fixes in order, each arriving when it was measured (plus `delay`). */
function run(fixes: readonly Fix[], gps = true, delay = 0, state = freshFilter(START)) {
  let current: FilterState = state;
  return fixes.map((fix) => {
    const result = filterFix(current, fix, fix.ts + delay, gps);
    current = result.state;
    return result;
  });
}

describe('which raw positions this phone uses (docs/ADR/0028)', () => {
  it('uses each newer position whole, and drops one not newer (the other source was first)', () => {
    const live = at(2_000, 3);
    const service = at(1_000, 1);
    const [first, late, same, next] = run([live, service, at(2_000, 4), at(3_000, 5)]);
    expect(first?.take).toBe(live);
    expect(first?.outcome).toBe('taken');
    expect(late).toMatchObject({ take: null, outcome: 'old' });
    expect(same).toMatchObject({ take: null, outcome: 'old' });
    expect(next?.outcome).toBe('taken');
  });

  it('drops a cached position', () => {
    const [cached] = run([at(0)], true, FIX_RULES.staleMs + 1);
    expect(cached).toMatchObject({ take: null, outcome: 'stale' });
    const [fresh] = run([at(0)], true, FIX_RULES.staleMs);
    expect(fresh?.outcome).toBe('taken');
  });

  it('with GPS, holds back Wi-Fi and cell guesses while good positions come', () => {
    const results = run([at(0), at(5_000, 0, 300), at(10_000, 5), at(15_000, 0, 120)]);
    expect(results.map((result) => result.outcome)).toEqual([
      'taken',
      'inaccurate',
      'taken',
      'inaccurate',
    ]);
  });

  it('indoors, sends the best guess as it is once nothing good came for a while', () => {
    const best = at(10_000, 40, 150);
    const results = run([
      at(0),
      at(5_000, 60, 400),
      best,
      at(20_000, 80, 300),
      at(FIX_RULES.fallbackMs, 90, 250),
    ]);
    const last = results.at(-1);
    expect(last?.outcome).toBe('fallback');
    // Untouched: its accuracy tells the other phones how rough it is.
    expect(last?.take).toBe(best);
    // The wait starts again: the next guess is held back for another while.
    const after = filterFix(nonNull(last).state, at(50_000, 90, 200), START + 50_000, true);
    expect(after.outcome).toBe('inaccurate');
  });

  it('never falls back on a guess that has gone stale', () => {
    const old = at(0, 0, 150);
    const [held] = run([old]);
    const now = START + FIX_RULES.staleMs + 10_000;
    const worse = at(FIX_RULES.staleMs + 9_000, 0, 600);
    const result = filterFix(nonNull(held).state, worse, now, true);
    expect(result.outcome).toBe('fallback');
    expect(result.take).toBe(worse);
  });

  it('without GPS (only coarse circles), a guess is a position like any other', () => {
    const [guess] = run([at(0, 0, 900)], false);
    expect(guess?.outcome).toBe('taken');
  });

  it('holds back a jump, and takes it after two more positions agree with it', () => {
    // 5 km in 5 s (3600 km/h) and outside both accuracies: a jump, then two that follow it.
    const results = run([at(0), at(5_000, 5_000), at(6_000, 5_010), at(7_000, 5_020)]);
    expect(results.map((result) => result.outcome)).toEqual(['taken', 'jump', 'jump', 'taken']);
  });

  it('never uses a lone outlier, and goes on from where the phone really is', () => {
    const results = run([at(0), at(5_000, 5_000), at(10_000, 20), at(15_000, 30), at(20_000, 40)]);
    expect(results.map((result) => result.outcome)).toEqual([
      'taken',
      'jump',
      'taken',
      'taken',
      'taken',
    ]);
  });

  it('lets a car on the motorway through (fast, but believable)', () => {
    // 40 m/s (144 km/h) for 5 s: 200 m.
    const results = run([at(0), at(5_000, 200), at(10_000, 400)]);
    expect(results.every((result) => result.outcome === 'taken')).toBe(true);
  });
});

function nonNull<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing');
  return value;
}
