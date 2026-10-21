import {
  backgroundLived,
  emptyMeasures,
  extend,
  median,
  received,
  recorder,
  sampled,
  sent,
  useMeasures,
} from './store';

const T = 1_800_000_000_000;

describe('the measurement overlay keeps (docs/ADR/0028)', () => {
  it('intervals between values, the newest ten, never a negative one', () => {
    let series = extend({ lastAt: null, gaps: [] }, T);
    expect(series.gaps).toEqual([]);
    series = extend(series, T + 1_000);
    series = extend(series, T + 500);
    expect(series).toEqual({ lastAt: T + 1_000, gaps: [1_000] });
    for (let index = 2; index <= 20; index += 1) series = extend(series, T + index * 1_000);
    expect(series.gaps).toHaveLength(10);
    expect(median([5_000, 1_000, 1_100, 900])).toBe(1_100);
    expect(median([])).toBeNull();
  });

  it("this phone's samples per source, what the filter did, and its sends", () => {
    let measures = emptyMeasures();
    measures = sampled(measures, { source: 'live', ts: T, acc: 6, at: T + 300, outcome: 'taken' });
    measures = sampled(measures, {
      source: 'live',
      ts: T + 1_000,
      acc: 300,
      at: T + 1_200,
      outcome: 'inaccurate',
    });
    measures = sampled(measures, {
      source: 'service',
      ts: T + 500,
      acc: 9,
      at: T + 1_300,
      outcome: 'old',
    });
    measures = sent(measures, { at: T + 300, live: true });
    expect(measures.sources.live.gaps).toEqual([1_000]);
    expect(measures.sources.service.lastAt).toBe(T + 500);
    expect(measures.ageMs).toBe(800);
    // The accuracy of what was used, not of what was dropped.
    expect(measures.acc).toBe(6);
    expect(measures.outcomes).toMatchObject({ taken: 1, inaccurate: 1, old: 1 });
    expect(measures.live).toBe(true);
  });

  it("friends' delay, gap and accuracy, and how many arrived late", () => {
    let measures = emptyMeasures();
    const friend = { userId: 'u1', acc: 8, ignored: false };
    measures = received(measures, { ...friend, ts: T, at: T + 1_500 });
    measures = received(measures, { ...friend, ts: T + 5_000, at: T + 6_200 });
    measures = received(measures, { ...friend, ts: T + 4_000, at: T + 6_300, ignored: true });
    expect(measures.friends.u1).toEqual({
      measured: { lastAt: T + 5_000, gaps: [5_000] },
      delayMs: 1_200,
      acc: 8,
      late: 1,
    });
  });

  it('counts background live mode: notices, minutes opened, and refusals by reason (ADR 0028 step 3)', () => {
    let measures = emptyMeasures();
    expect(measures.backgroundLive).toEqual({
      notices: 0,
      opened: 0,
      openedMs: 0,
      refused: {
        setting: 0,
        ghost: 0,
        notShared: 0,
        coarse: 0,
        expired: 0,
        paused: 0,
        batterySaver: 0,
        batteryLow: 0,
        cap: 0,
        os: 0,
      },
    });
    for (let index = 0; index < 4; index += 1) {
      measures = backgroundLived(measures, { kind: 'notice' });
    }
    measures = backgroundLived(measures, { kind: 'opened', ms: 120_000 });
    measures = backgroundLived(measures, { kind: 'opened', ms: 90_000 });
    measures = backgroundLived(measures, { kind: 'refused', reason: 'cap' });
    measures = backgroundLived(measures, { kind: 'refused', reason: 'cap' });
    measures = backgroundLived(measures, { kind: 'refused', reason: 'batteryLow' });
    expect(measures.backgroundLive).toMatchObject({
      notices: 4,
      opened: 2,
      openedMs: 210_000,
      refused: { cap: 2, batteryLow: 1, os: 0, ghost: 0 },
    });
  });

  it('hears background live mode from the pipeline too, with times and counts only', () => {
    const before = useMeasures.getState().backgroundLive;
    recorder.backgroundLive({ kind: 'notice' });
    recorder.backgroundLive({ kind: 'opened', ms: 60_000 });
    recorder.backgroundLive({ kind: 'refused', reason: 'ghost' });
    const after = useMeasures.getState().backgroundLive;
    expect(after.notices).toBe(before.notices + 1);
    expect(after.openedMs).toBe(before.openedMs + 60_000);
    expect(after.refused.ghost).toBe(before.refused.ghost + 1);
    expect(JSON.stringify(after)).not.toMatch(/"lat"|"lng"|circle/);
  });

  it('only in memory, from the location pipeline, without positions', () => {
    recorder.sampled({ source: 'service', ts: T, acc: 12, at: T, outcome: 'taken' });
    recorder.sent({ at: T, live: false });
    recorder.received({ userId: 'u2', ts: T, acc: 20, at: T + 900, ignored: false });
    const state = useMeasures.getState();
    expect(state.outcomes.taken).toBe(1);
    expect(state.friends.u2?.delayMs).toBe(900);
    expect(JSON.stringify(state)).not.toMatch(/"lat"|"lng"/);
  });
});
