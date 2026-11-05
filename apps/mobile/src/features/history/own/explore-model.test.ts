import { distanceM } from '../../location/send';
import type { TracePoint } from '../trail-model';
import {
  boundsOfCells,
  cellOf,
  cellsOfDay,
  coarser,
  cornersOf,
  explore,
  EXPLORE,
  type Fog,
  fogOf,
  outlines,
  slicer,
} from './explore-model';

const TILES = 2 ** EXPLORE.zoom;
const cell = (x: number, y: number) => x * TILES + y;
const MIN = 60_000;

// Taksim; a degree of latitude is about 111 km.
const at = (minutes: number, north = 0, acc = 10): TracePoint => ({
  at: Date.UTC(2026, 10, 2, 9) + minutes * MIN,
  lat: 41.0369 + north / 111_000,
  lng: 28.985,
  acc,
});

/** Twice the signed area with latitude up: above zero for an anticlockwise ring. */
function area2(ring: readonly [number, number][]): number {
  let sum = 0;
  for (let i = 0; i + 1 < ring.length; i += 1) {
    const [x, y] = ring[i] ?? [0, 0];
    const [nx, ny] = ring[i + 1] ?? [0, 0];
    sum += x * ny - nx * y;
  }
  return sum;
}

/** The corners a fog is drawn with (each ring closed by repeating its first point). */
const drawnCorners = (fog: Fog) =>
  fog.coordinates.flat().reduce((sum, ring) => sum + ring.length - 1, 0);

/** The same numbers on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

describe('the discovery map squares (docs/ADR/0030 Ek 2)', () => {
  it('cuts the map into squares of about 230 m in Türkiye', () => {
    const here = at(0);
    const x = Math.floor(cellOf(here.lat, here.lng) / TILES);
    // The next square to the east starts one tile on: walk east until the number changes.
    let metres = 0;
    while (Math.floor(cellOf(here.lat, here.lng + metres / 84_000) / TILES) === x) metres += 5;
    expect(metres).toBeLessThanOrEqual(240);
    // And a square further on is a different one.
    expect(cellOf(here.lat, here.lng + 300 / 84_000)).not.toBe(cellOf(here.lat, here.lng));
  });

  it('opens the square of a precise point, and none for a vague one', () => {
    expect(cellsOfDay([at(0)]).size).toBe(1);
    expect(cellsOfDay([at(0, 0, EXPLORE.maxAccM + 1)]).size).toBe(0);
  });

  it('joins two points close in time and place with a line of squares', () => {
    const a = at(0);
    const b = at(5, 1_000);
    expect(distanceM(a, b)).toBeLessThan(EXPLORE.joinM);
    const open = cellsOfDay([b, a]);
    // A kilometre north is four or five squares, all in one column with no hole.
    const rows = [...open].map((c) => c % TILES).sort((p, q) => p - q);
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect((rows.at(-1) ?? 0) - (rows[0] ?? 0) + 1).toBe(rows.length);
    expect(new Set([...open].map((c) => Math.floor(c / TILES))).size).toBe(1);
  });

  it('never fills a "Kayıt yok" silence, a long jump or a vague point between', () => {
    expect(cellsOfDay([at(0), at(50, 1_000)]).size).toBe(2);
    expect(cellsOfDay([at(0), at(5, 3_000)]).size).toBe(2);
    expect(cellsOfDay([at(0), at(2, 500, 400), at(5, 1_000)]).size).toBe(2);
  });

  it('adds into the squares already open (one set for every kept day)', () => {
    const open = cellsOfDay([at(0)]);
    cellsOfDay([at(0, 2_000)], open);
    expect(open.size).toBe(2);
  });

  it('coarsens four squares into one, and nothing visited closes', async () => {
    const fine = new Set([cell(100, 100), cell(101, 101), cell(300, 300)]);
    const coarse = await coarser(fine, EXPLORE.zoom);
    const half = TILES / 2;
    expect(coarse).toEqual(new Set([50 * half + 50, 150 * half + 150]));
    const [west, south, east, north] = boundsOfCells(fine, EXPLORE.zoom) ?? [0, 0, 0, 0];
    const [cw, cs, ce, cn] = boundsOfCells(coarse, EXPLORE.zoom - 1) ?? [0, 0, 0, 0];
    expect(cw).toBeLessThanOrEqual(west);
    expect(cs).toBeLessThanOrEqual(south);
    expect(ce).toBeGreaterThanOrEqual(east);
    expect(cn).toBeGreaterThanOrEqual(north);
  });
});

describe('the fog over the map', () => {
  it('has the whole world with one square hole for one square', async () => {
    const fog = await fogOf(new Set([cell(100, 100)]));
    expect(fog.coordinates).toHaveLength(1);
    const [world, hole] = fog.coordinates[0] ?? [];
    expect(world).toHaveLength(5);
    expect(hole).toHaveLength(5);
    // The right-hand rule: outer edges anticlockwise, holes clockwise.
    expect(area2(world ?? [])).toBeGreaterThan(0);
    expect(area2(hole ?? [])).toBeLessThan(0);
  });

  it('merges squares side by side into one outline', async () => {
    const fog = await fogOf(new Set([cell(100, 100), cell(101, 100), cell(101, 101)]));
    const [, hole] = fog.coordinates[0] ?? [];
    // An L of three squares has six corners (closed: seven points).
    expect(hole).toHaveLength(7);
  });

  it('keeps squares touching only at a corner as two outlines', async () => {
    expect(await outlines(new Set([cell(100, 100), cell(101, 101)]))).toHaveLength(2);
    const fog = await fogOf(new Set([cell(100, 100), cell(101, 101)]));
    expect(fog.coordinates[0]?.slice(1).map((ring) => ring.length)).toEqual([5, 5]);
  });

  it('puts fog back in an unvisited square ringed by visited ones', async () => {
    const ring = new Set<number>();
    for (let x = 0; x < 3; x += 1) {
      for (let y = 0; y < 3; y += 1) if (x !== 1 || y !== 1) ring.add(cell(200 + x, 200 + y));
    }
    const fog = await fogOf(ring);
    expect(fog.coordinates).toHaveLength(2);
    // The world with the ring's outer edge as a hole, and the middle square as fog of its own.
    expect(fog.coordinates[0]).toHaveLength(2);
    expect(fog.coordinates[1]).toHaveLength(1);
    expect(fog.coordinates[1]?.[0]).toHaveLength(5);
    expect(area2(fog.coordinates[1]?.[0] ?? [])).toBeGreaterThan(0);
  });

  it('opens a square inside that fog again, in the right place', async () => {
    const frame = new Set<number>();
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        if (x === 0 || y === 0 || x === 4 || y === 4) frame.add(cell(300 + x, 300 + y));
      }
    }
    frame.add(cell(302, 302));
    const fog = await fogOf(frame);
    expect(fog.coordinates).toHaveLength(2);
    expect(fog.coordinates[0]).toHaveLength(2);
    // The frame's inside is fog, with the middle square open in it.
    expect(fog.coordinates[1]).toHaveLength(2);
    expect(fog.coordinates[1]?.[1]).toHaveLength(5);
  });

  it('is the whole world when nothing was visited', async () => {
    expect((await fogOf(new Set())).coordinates).toEqual([[expect.any(Array)]]);
    expect(
      await explore(
        [],
        () => [],
        slicer(),
        () => false,
      ),
    ).toMatchObject({ bounds: null });
  });

  it('counts its corners without drawing it, exactly as drawn', async () => {
    const random = seeded(7);
    for (let round = 0; round < 20; round += 1) {
      const cells = new Set<number>();
      for (let n = 0; n < 60; n += 1) {
        cells.add(cell(1_000 + Math.floor(random() * 12), 1_000 + Math.floor(random() * 12)));
      }
      const fog = await fogOf(cells);
      expect(await cornersOf(cells, EXPLORE.zoom)).toBe(drawnCorners(fog));
    }
  });

  it('stops inside adversarial nested frames without returning a partial fog', async () => {
    const frames = new Set<number>();
    for (let inset = 0; inset < 36; inset += 3) {
      const low = 500 + inset;
      const high = 700 - inset;
      for (let n = low; n <= high; n += 1) {
        frames.add(cell(n, low));
        frames.add(cell(n, high));
        frames.add(cell(low, n));
        frames.add(cell(high, n));
      }
    }
    // Count operations, not wall time: the fake clock always reads zero and every checkpoint
    // breathes. Cancel after the same outline work plus two checkpoints in fog construction.
    let outlinePauses = 0;
    await outlines(
      frames,
      EXPLORE.zoom,
      slicer(
        0,
        () => 0,
        () => {
          outlinePauses += 1;
          return Promise.resolve();
        },
      ),
    );
    const cancelAfter = outlinePauses + 2;
    let pauses = 0;
    const breath = slicer(
      0,
      () => 0,
      () => {
        pauses += 1;
        return Promise.resolve();
      },
    );
    await expect(fogOf(frames, EXPLORE.zoom, breath, () => pauses >= cancelAfter)).rejects.toThrow(
      'Discovery map work cancelled',
    );
    expect(pauses).toBe(cancelAfter);
    expect(pauses).toBeGreaterThan(outlinePauses);
  });
});

describe('the discovery map corner budget', () => {
  it('coarsens below minZoom when 6000 separate squares still have too many corners', async () => {
    const tiles = 2 ** EXPLORE.minZoom;
    const points: TracePoint[] = [];
    for (let row = 0; row < 80; row += 1) {
      for (let column = 0; column < 75; column += 1) {
        // At zoom 12 there is an empty square between points. At zoom 11 they form one block.
        const x = 100 + column * 2 + 0.5;
        const y = 100 + row * 2 + 0.5;
        points.push({
          at: points.length * MIN,
          lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tiles))) * 180) / Math.PI,
          lng: (x / tiles) * 360 - 180,
          acc: 10,
        });
      }
    }
    const atMinimum = new Set(points.map((point) => cellOf(point.lat, point.lng, EXPLORE.minZoom)));
    expect(atMinimum.size).toBe(6_000);
    expect(await cornersOf(atMinimum, EXPLORE.minZoom)).toBe(24_004);

    const explored = await explore(
      ['day'],
      () => points,
      () => Promise.resolve(),
      () => false,
    );
    expect(explored).not.toBeNull();
    expect(explored?.zoom).toBeLessThan(EXPLORE.minZoom);
    expect(
      drawnCorners(explored?.fog ?? { type: 'MultiPolygon', coordinates: [] }),
    ).toBeLessThanOrEqual(EXPLORE.maxCorners);
  });
});

describe('the discovery map of a whole year (the PM, 2026-11-02)', () => {
  /** A scattered year: 300 points a day, walking, with jumps of up to 30 km around Istanbul. */
  function year() {
    const random = seeded(2026);
    const days = Array.from({ length: 365 }, (_, day) => String(day));
    const read = (day: string): TracePoint[] => {
      let lat = 41 + random() * 0.3;
      let lng = 28.8 + random() * 0.4;
      let time = Number(day) * 86_400_000;
      return Array.from({ length: 300 }, () => {
        if (random() < 0.05) {
          lat = 41 + random() * 0.3;
          lng = 28.8 + random() * 0.4;
        } else {
          lat += (random() - 0.5) * 0.004;
          lng += (random() - 0.5) * 0.004;
        }
        time += (1 + random() * 4) * MIN;
        return { at: time, lat, lng, acc: 10 + random() * 50 };
      });
    };
    return { days, read };
  }

  it('is worked out in slices that leave the thread free, within the budget', async () => {
    const { days, read } = year();
    let mark = performance.now();
    let longest = 0;
    let pauses = 0;
    const pause = async () => {
      longest = Math.max(longest, performance.now() - mark);
      pauses += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      mark = performance.now();
    };
    const started = performance.now();
    const explored = await explore(
      days,
      read,
      slicer(EXPLORE.sliceMs, undefined, pause),
      () => false,
    );
    longest = Math.max(longest, performance.now() - mark);
    const total = performance.now() - started;
    // The test machine's budget (ADR 0030 Ek 2); the phone's own aim is 8 ms a slice.
    expect(longest).toBeLessThan(50);
    expect(total).toBeLessThan(3_000);
    expect(pauses).toBeGreaterThan(10);
    // A layer the map draws smoothly: few enough corners, the squares coarsened when needed.
    expect(
      drawnCorners(explored?.fog ?? { type: 'MultiPolygon', coordinates: [] }),
    ).toBeLessThanOrEqual(EXPLORE.maxCorners);
    expect(explored?.zoom).toBeLessThanOrEqual(EXPLORE.zoom);
    expect(explored?.bounds).not.toBeNull();
  }, 30_000);

  it('stops when the screen is left', async () => {
    const { days, read } = year();
    let reads = 0;
    let left = false;
    const explored = await explore(
      days,
      (day) => {
        reads += 1;
        if (reads === 10) left = true;
        return read(day);
      },
      slicer(),
      () => left,
    );
    expect(explored).toBeNull();
    expect(reads).toBe(10);
  });
});
