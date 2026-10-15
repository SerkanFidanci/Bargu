import {
  HISTORY_KEEP_MS,
  HISTORY_SLOT_MS,
  MAX_TRAIL_POINTS,
  type TrailPoint,
} from '@bargu/schemas';

import {
  closeDue,
  fromPoint,
  historyDays,
  type Piece,
  recordFix,
  segments,
  stillKept,
  thin,
  toPoint,
  type TracePoint,
  TRAIL,
  withFix,
} from './trail-model';

const MIN = 60_000;
const slot = 1_791_880_200_000;
const home = { lat: 41.0082, lng: 28.9784 };
/** A position `meters` north of home at `ts`. */
const north = (meters: number, ts: number, acc = 8) => ({
  lat: home.lat + meters / 111_320,
  lng: home.lng,
  acc,
  ts,
});

describe('writing a trail down', () => {
  it('keeps a point to about a metre, seconds into its quarter hour', () => {
    const point = toPoint({ ...home, acc: 7.6, ts: slot + 61_400 }, slot);
    expect(point).toEqual([61, 4_100_820, 2_897_840, 8]);
    expect(fromPoint(point, slot)).toEqual({
      at: slot + 61_000,
      lat: 41.0082,
      lng: 28.9784,
      acc: 8,
    });
  });

  it('adds a position when it moved or some minutes passed, and skips vague ones', () => {
    let points: TrailPoint[] = withFix([], north(0, slot, 300), slot);
    expect(points).toHaveLength(1);
    points = withFix(points, north(10, slot + MIN), slot);
    expect(points).toHaveLength(1);
    points = withFix(points, north(40, slot + 2 * MIN), slot);
    expect(points).toHaveLength(2);
    points = withFix(points, north(45, slot + 2 * MIN + TRAIL.everyMs), slot);
    expect(points).toHaveLength(3);
    expect(withFix(points, north(500, slot + 9 * MIN, 150), slot)).toHaveLength(3);
  });

  it('thins out past the most a piece holds, keeping the ends', () => {
    const many: TrailPoint[] = Array.from({ length: MAX_TRAIL_POINTS }, (_, i) => [i, i, i, 1]);
    const next = withFix(many, north(5_000, slot + 899_000), slot);
    expect(next.length).toBeLessThanOrEqual(MAX_TRAIL_POINTS);
    expect(next[0]).toEqual([0, 0, 0, 1]);
    expect(next.at(-1)?.[0]).toBe(899);
    // Every other one between the ends goes.
    expect(
      thin([
        [0, 0, 0, 0],
        [1, 1, 1, 1],
        [2, 2, 2, 2],
      ]),
    ).toEqual([
      [0, 0, 0, 0],
      [2, 2, 2, 2],
    ]);
  });
});

describe('pieces per circle', () => {
  const circles = [
    { id: 'a', epoch: 3 },
    { id: 'b', epoch: 7 },
  ];

  it('writes a position for each circle that gets the history, in its epoch of then', () => {
    const { open, finished } = recordFix({}, north(0, slot + MIN), circles);
    expect(finished).toEqual([]);
    expect(open.a).toEqual({
      circleId: 'a',
      slot,
      epoch: 3,
      points: [[60, 4_100_820, 2_897_840, 8]],
    });
    expect(open.b?.epoch).toBe(7);
  });

  it('finishes a quarter hour once the next begins, and drops that of a circle no longer getting it', () => {
    const first = recordFix({}, north(0, slot + MIN), circles).open;
    const next = recordFix(first, north(0, slot + HISTORY_SLOT_MS + MIN), [{ id: 'a', epoch: 4 }]);
    // "b" stopped getting it (a ghost, a pause): what was written for it is never sent.
    expect(next.finished.map((piece) => piece.circleId)).toEqual(['a']);
    expect(next.open.a).toMatchObject({ slot: slot + HISTORY_SLOT_MS, epoch: 4 });
    expect(next.open.b).toBeUndefined();
  });

  it('finishes pieces when their quarter hour ends without a position', () => {
    const open: Record<string, Piece> = {
      a: { circleId: 'a', slot, epoch: 3, points: [[0, 0, 0, 1]] },
      b: { circleId: 'b', slot: slot + HISTORY_SLOT_MS, epoch: 7, points: [[0, 0, 0, 1]] },
    };
    const closed = closeDue(open, slot + HISTORY_SLOT_MS + MIN);
    expect(closed.finished.map((piece) => piece.circleId)).toEqual(['a']);
    expect(Object.keys(closed.open)).toEqual(['b']);
    expect(stillKept({ slot }, slot + HISTORY_KEEP_MS - HISTORY_SLOT_MS)).toBe(true);
    expect(stillKept({ slot }, slot + HISTORY_KEEP_MS)).toBe(false);
  });
});

describe('reading a day', () => {
  /** Positions `every` ms apart from `from`, each `step` metres further north of `start`. */
  const walk = (from: number, start: number, step: number, count: number, every = MIN) =>
    Array.from({ length: count }, (_, i): TracePoint => {
      const at = north(start + step * i, from + every * i);
      return { at: at.ts, lat: at.lat, lng: at.lng, acc: 8 };
    });

  it('tells stays, trips and how they went, and gaps where nothing is known', () => {
    const t0 = slot;
    const points = [
      // At home 20 minutes.
      ...walk(t0, 0, 2, 21),
      // Driving 6 km in 10 minutes (10 m/s).
      ...walk(t0 + 21 * MIN, 100, 600, 10),
      // At work 30 minutes.
      ...walk(t0 + 31 * MIN, 6_000, 1, 31),
      // Nothing for an hour, then home again.
      ...walk(t0 + 122 * MIN, 0, 1, 10),
    ];
    const timeline = segments(points);
    expect(timeline.map((segment) => segment.kind)).toEqual([
      'stay',
      'move',
      'stay',
      'gap',
      'stay',
    ]);
    const drive = timeline[1];
    expect(drive?.kind === 'move' ? drive.mode : null).toBe('vehicle');
    expect(drive?.kind === 'move' ? drive.meters : 0).toBeGreaterThan(5_000);
    const work = timeline[2];
    expect(work?.kind === 'stay' ? work.to - work.from : 0).toBe(30 * MIN);
  });

  it('walks at walking pace', () => {
    const timeline = segments([...walk(slot, 0, 70, 15), ...walk(slot + 15 * MIN, 1_050, 1, 10)]);
    const walked = timeline.find((segment) => segment.kind === 'move');
    expect(walked?.kind === 'move' ? walked.mode : null).toBe('walk');
    expect(segments([])).toEqual([]);
  });

  it('offers today and the thirteen days before', () => {
    const days = historyDays(slot);
    expect(days).toHaveLength(14);
    expect(new Date(days[0] ?? 0).getHours()).toBe(0);
    expect((days[0] ?? 0) - (days[1] ?? 0)).toBeGreaterThanOrEqual(23 * 60 * MIN);
  });
});
