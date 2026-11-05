import { distanceM } from '../../location/send';
import { SEGMENTS, type TracePoint } from '../trail-model';

/**
 * The discovery map (docs/ADR/0030 Ek 2): the places one has been, from the days the own history
 * already keeps, drawn as a fog with the visited squares open. Worked out on this phone and held in
 * memory only; nothing here is stored or sent, and a day that is forgotten drops out with it. The
 * work is done a slice at a time, giving the JS thread back in between (the PM's condition).
 */

export const EXPLORE = {
  /** Web Mercator tiles of this zoom are the squares: about 230 m a side in Türkiye. */
  zoom: 17,
  /** A coarse year often reaches this zoom, but it is not a floor: the corner budget wins. */
  minZoom: 12,
  /** A point vaguer than this opens no square (a coarse trail would open the wrong ones). */
  maxAccM: 250,
  /** Two points in a row this close are joined by a straight line; farther apart, they are not. */
  joinM: 1_500,
  /** The fog's corners at most, for the map layer to stay smooth; beyond, the squares coarsen. */
  maxCorners: 20_000,
  /** The longest one slice of work holds the JS thread (half a frame at 60 fps). */
  sliceMs: 8,
} as const;

const EARTH_M = 40_075_016.686;
const tilesAt = (zoom: number) => 2 ** zoom;

/**
 * Gives the JS thread back once a slice of work has run its time: awaited often in the loops
 * below, it pauses only when `sliceMs` has passed since the last pause.
 */
export type Breath = () => Promise<void>;
type Cancelled = () => boolean;

export function slicer(
  sliceMs: number = EXPLORE.sliceMs,
  now: () => number = () => performance.now(),
  pause: () => Promise<void> = () =>
    new Promise((resolve) => {
      setTimeout(resolve, 0);
    }),
): Breath {
  let since = now();
  return async () => {
    if (now() - since < sliceMs) return;
    await pause();
    since = now();
  };
}

/** How many steps of a loop between asking for a breath (a clock read is not free). */
const STEP = 256;
/** The same for a day's points, each of which may open a line of squares. */
const DAY_STEP = 32;

class ExploreCancelled extends Error {
  constructor() {
    super('Discovery map work cancelled');
  }
}

/** Cooperative work: cancellation is cheap to check; the clock is read only once a slice. */
class Work {
  private steps = 0;

  constructor(
    private readonly breath: Breath,
    private readonly cancelled: Cancelled,
  ) {}

  check(): void {
    if (this.cancelled()) throw new ExploreCancelled();
  }

  /** Whether this operation completes a slice. Every loop calls this, including nested ones. */
  tick(): boolean {
    this.check();
    this.steps += 1;
    return this.steps % STEP === 0;
  }

  async pause(): Promise<void> {
    this.check();
    await this.breath();
    // A blur while the thread is free must stop the next slice, not resume old work.
    this.check();
  }
}

const notCancelled: Cancelled = () => false;

/** The square a place falls in, as one number (x · 2^zoom + y). */
export function cellOf(lat: number, lng: number, zoom: number = EXPLORE.zoom): number {
  const tiles = tilesAt(zoom);
  // The tiles end at about 85° (the poles never fit a square map).
  const rad = (Math.min(85, Math.max(-85, lat)) * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * tiles);
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * tiles);
  const clamp = (n: number) => Math.min(tiles - 1, Math.max(0, n));
  return clamp(x) * tiles + clamp(y);
}

function usable(point: TracePoint): boolean {
  return point.acc <= EXPLORE.maxAccM;
}

/**
 * The squares a day's points open: each precise enough point opens its own, and two in a row
 * close in time and place are joined by a straight line (a silence of `gapMs`, "Kayıt yok", never).
 */
export function cellsOfDay(
  points: readonly TracePoint[],
  into = new Set<number>(),
  zoom: number = EXPLORE.zoom,
): Set<number> {
  const walk = dayWalker(into, zoom);
  for (const point of [...points].sort((a, b) => a.at - b.at)) walk(point);
  return into;
}

/** A day's points one by one, in time order, opening squares into `into` (as `cellsOfDay`). */
function dayWalker(into: Set<number>, zoom: number): (point: TracePoint) => void {
  let before: TracePoint | undefined;
  return (point) => {
    if (!usable(point)) {
      before = undefined;
      return;
    }
    into.add(cellOf(point.lat, point.lng, zoom));
    if (before !== undefined && point.at - before.at <= SEGMENTS.gapMs) {
      const metres = distanceM(before, point);
      if (metres <= EXPLORE.joinM) {
        const side = (EARTH_M * Math.cos((point.lat * Math.PI) / 180)) / tilesAt(zoom);
        const steps = Math.ceil(metres / (side / 2));
        for (let step = 1; step < steps; step += 1) {
          const t = step / steps;
          into.add(
            cellOf(
              before.lat + (point.lat - before.lat) * t,
              before.lng + (point.lng - before.lng) * t,
              zoom,
            ),
          );
        }
      }
    }
    before = point;
  };
}

/** The same places in squares one zoom coarser (four become one: nothing visited closes). */
export async function coarser(
  cells: ReadonlySet<number>,
  zoom: number,
  breath: Breath = noBreath,
  cancelled: Cancelled = notCancelled,
): Promise<Set<number>> {
  const work = new Work(breath, cancelled);
  const tiles = tilesAt(zoom);
  const next = new Set<number>();
  for (const cell of cells) {
    const x = Math.floor(cell / tiles);
    const y = cell % tiles;
    next.add(Math.floor(x / 2) * (tiles / 2) + Math.floor(y / 2));
    if (work.tick()) await work.pause();
  }
  work.check();
  return next;
}

const noBreath: Breath = () => Promise.resolve();

/**
 * The corners the fog of these squares has, counted without drawing it: around each corner point
 * the four squares say whether the edge turns there (one or three visited: one corner; two that
 * touch only at it: two, one for each outline; two side by side, none or all four: none).
 */
export async function cornersOf(
  cells: ReadonlySet<number>,
  zoom: number,
  breath: Breath = noBreath,
  cancelled: Cancelled = notCancelled,
): Promise<number> {
  const work = new Work(breath, cancelled);
  const tiles = tilesAt(zoom);
  const has = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < tiles && y < tiles && cells.has(x * tiles + y);
  const seen = new Set<number>();
  let corners = 0;
  for (const cell of cells) {
    const cx = Math.floor(cell / tiles);
    const cy = cell % tiles;
    for (const [vx, vy] of [
      [cx, cy],
      [cx + 1, cy],
      [cx, cy + 1],
      [cx + 1, cy + 1],
    ] as const) {
      const key = vx * (tiles + 1) + vy;
      if (seen.has(key)) continue;
      seen.add(key);
      const nw = has(vx - 1, vy - 1);
      const ne = has(vx, vy - 1);
      const sw = has(vx - 1, vy);
      const se = has(vx, vy);
      const count = Number(nw) + Number(ne) + Number(sw) + Number(se);
      if (count === 1 || count === 3) corners += 1;
      else if (count === 2 && nw === se) corners += 2;
    }
    if (work.tick()) await work.pause();
  }
  work.check();
  // The world's own four.
  return corners + 4;
}

type Vertex = readonly [number, number];

/** The outlines of the visited squares, in tile corners: outer edges clockwise on screen. */
export async function outlines(
  cells: ReadonlySet<number>,
  zoom: number = EXPLORE.zoom,
  breath: Breath = noBreath,
  cancelled: Cancelled = notCancelled,
): Promise<Vertex[][]> {
  const work = new Work(breath, cancelled);
  const tiles = tilesAt(zoom);
  const has = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < tiles && y < tiles && cells.has(x * tiles + y);
  // Each square gives the edges no visited neighbour shares, walked with the square on the right.
  const out = new Map<number, Vertex[]>();
  const key = (x: number, y: number) => x * (tiles + 1) + y;
  const edge = (from: Vertex, to: Vertex) => {
    const list = out.get(key(from[0], from[1])) ?? [];
    list.push(to);
    out.set(key(from[0], from[1]), list);
  };
  for (const cell of cells) {
    const x = Math.floor(cell / tiles);
    const y = cell % tiles;
    if (!has(x, y - 1)) edge([x, y], [x + 1, y]);
    if (!has(x + 1, y)) edge([x + 1, y], [x + 1, y + 1]);
    if (!has(x, y + 1)) edge([x + 1, y + 1], [x, y + 1]);
    if (!has(x - 1, y)) edge([x, y + 1], [x, y]);
    if (work.tick()) await work.pause();
  }
  const rings: Vertex[][] = [];
  for (const [startKey, starts] of out) {
    const start: Vertex = [Math.floor(startKey / (tiles + 1)), startKey % (tiles + 1)];
    for (let first = starts.pop(); first !== undefined; first = starts.pop()) {
      const ring: Vertex[] = [start];
      let from = start;
      let to: Vertex | undefined = first;
      while (to !== undefined && !(to[0] === start[0] && to[1] === start[1])) {
        ring.push(to);
        const [tx, ty]: Vertex = to;
        const dx = tx - from[0];
        const dy = ty - from[1];
        const next: Vertex[] = out.get(key(tx, ty)) ?? [];
        // Where two squares touch at a corner, turn right: each region keeps its own outline.
        const right = next.findIndex(([vx, vy]) => vx - tx === -dy && vy - ty === dx);
        [to] = next.splice(right >= 0 ? right : next.length - 1, 1);
        from = [tx, ty];
        if (work.tick()) await work.pause();
      }
      rings.push(await straighten(ring, work));
    }
  }
  work.check();
  return rings;
}

/** The ring's corner at an index, going round. */
function corner(ring: readonly Vertex[], index: number): Vertex {
  return ring[((index % ring.length) + ring.length) % ring.length] ?? [0, 0];
}

/** Drops the corners in the middle of straight runs, without holding the thread for a long ring. */
async function straighten(ring: readonly Vertex[], work: Work): Promise<Vertex[]> {
  const result: Vertex[] = [];
  for (const [index, point] of ring.entries()) {
    const prev = corner(ring, index - 1);
    const next = corner(ring, index + 1);
    if (
      (point[0] - prev[0]) * (next[1] - point[1]) !==
      (point[1] - prev[1]) * (next[0] - point[0])
    ) {
      result.push(point);
    }
    if (work.tick()) await work.pause();
  }
  return result;
}

/** Twice the signed area on screen: above zero for a clockwise ring (a region's outer edge). */
async function area2(ring: readonly Vertex[], work: Work): Promise<number> {
  let sum = 0;
  for (const [index, [x, y]] of ring.entries()) {
    const [nx, ny] = corner(ring, index + 1);
    sum += x * ny - nx * y;
    if (work.tick()) await work.pause();
  }
  return sum;
}

/** Whether a point (not on any corner's row) is inside a ring: a ray to the east. */
async function inside(
  px: number,
  py: number,
  ring: readonly Vertex[],
  work: Work,
): Promise<boolean> {
  let hit = false;
  for (const [index, [x1, y1]] of ring.entries()) {
    const [x2, y2] = corner(ring, index + 1);
    if (y1 > py !== y2 > py && px < x1 + ((py - y1) * (x2 - x1)) / (y2 - y1)) hit = !hit;
    if (work.tick()) await work.pause();
  }
  return hit;
}

/** A square's centre just inside a region's outer edge (the square right of its first edge). */
function pointIn(ring: readonly Vertex[]): [number, number] {
  const [x0, y0] = corner(ring, 0);
  const [x1, y1] = corner(ring, 1);
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  return [x0 + dx / 2 - dy / 2, y0 + dy / 2 + dx / 2];
}

/** A ring's box, to skip the rings a point cannot be in. */
async function boxOf(
  ring: readonly Vertex[],
  work: Work,
): Promise<[number, number, number, number]> {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    if (work.tick()) await work.pause();
  }
  return [minX, minY, maxX, maxY];
}

function toLngLat([x, y]: Vertex, zoom: number): [number, number] {
  const tiles = tilesAt(zoom);
  const lng = (x / tiles) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / tiles))) * 180) / Math.PI;
  return [lng, lat];
}

async function closed(
  ring: readonly Vertex[],
  zoom: number,
  work: Work,
): Promise<[number, number][]> {
  const points: [number, number][] = [];
  for (const vertex of ring) {
    points.push(toLngLat(vertex, zoom));
    if (work.tick()) await work.pause();
  }
  const first = points[0];
  return first === undefined ? [] : [...points, first];
}

export interface Fog {
  type: 'MultiPolygon';
  coordinates: [number, number][][][];
}

/**
 * The fog: the whole map less the visited squares, as GeoJSON for a fill layer. A region's outer
 * edge is a hole in the fog; a hole inside a region is fog again, holding the regions inside it.
 * Rings follow the right-hand rule (outer edges anticlockwise on the globe).
 */
export async function fogOf(
  cells: ReadonlySet<number>,
  zoom: number = EXPLORE.zoom,
  breath: Breath = noBreath,
  cancelled: Cancelled = notCancelled,
): Promise<Fog> {
  const work = new Work(breath, cancelled);
  const tiles = tilesAt(zoom);
  const rings = await outlines(cells, zoom, breath, cancelled);
  const regions: Vertex[][] = [];
  const holes: Vertex[][] = [];
  for (const ring of rings) {
    const area = await area2(ring, work);
    if (area > 0) regions.push(ring);
    else if (area < 0) holes.push(ring);
  }
  // Tile rows run south, so a ring clockwise on screen is clockwise on the globe too: region
  // edges are already holes and holes in regions already outer rings; the world goes the other way.
  const world: Vertex[] = [
    [0, 0],
    [0, tiles],
    [tiles, tiles],
    [tiles, 0],
  ];
  // The fog's outer rings: the world, and every hole in a region. Each region sits in the
  // smallest of them around it.
  const outers = [world, ...holes];
  const boxes: [number, number, number, number][] = [];
  const sizes: number[] = [];
  const within: Vertex[][][] = [];
  for (const outer of outers) {
    boxes.push(await boxOf(outer, work));
    sizes.push(Math.abs(await area2(outer, work)));
    within.push([]);
  }
  for (const region of regions) {
    const [px, py] = pointIn(region);
    let best = 0;
    let bestArea = Infinity;
    for (let index = 1; index < outers.length; index += 1) {
      if (work.tick()) await work.pause();
      const [minX, minY, maxX, maxY] = boxes[index] ?? [0, 0, 0, 0];
      const size = sizes[index] ?? Infinity;
      if (px < minX || px > maxX || py < minY || py > maxY || size >= bestArea) continue;
      if (await inside(px, py, outers[index] ?? [], work)) {
        best = index;
        bestArea = size;
      }
    }
    within[best]?.push(region);
    if (work.tick()) await work.pause();
  }
  const coordinates: [number, number][][][] = [];
  for (const [index, outer] of outers.entries()) {
    const polygon = [await closed(outer, zoom, work)];
    for (const ring of within[index] ?? []) polygon.push(await closed(ring, zoom, work));
    coordinates.push(polygon);
  }
  work.check();
  return { type: 'MultiPolygon', coordinates };
}

/** The area the visited squares cover, for the camera: [west, south, east, north]. */
export function boundsOfCells(
  cells: ReadonlySet<number>,
  zoom: number,
): [number, number, number, number] | null {
  const tiles = tilesAt(zoom);
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const cell of cells) {
    const x = Math.floor(cell / tiles);
    const y = cell % tiles;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + 1);
    maxY = Math.max(maxY, y + 1);
  }
  if (minX === Infinity) return null;
  const [west, north] = toLngLat([minX, minY], zoom);
  const [east, south] = toLngLat([maxX, maxY], zoom);
  return [west, south, east, north];
}

export interface Explored {
  fog: Fog;
  bounds: [number, number, number, number] | null;
  /** The zoom of its squares: the usual one, or coarser for a very scattered year. */
  zoom: number;
}

/**
 * The discovery map of the days kept: each day read and turned into squares, a slice at a time;
 * coarsened while its fog would have too many corners; null when `cancelled` (the screen left).
 */
export async function explore(
  days: readonly string[],
  read: (day: string) => readonly TracePoint[],
  breath: Breath,
  cancelled: () => boolean,
): Promise<Explored | null> {
  const work = new Work(breath, cancelled);
  try {
    let cells = new Set<number>();
    for (const day of days) {
      work.check();
      const walk = dayWalker(cells, EXPLORE.zoom);
      const points = [...read(day)].sort((a, b) => a.at - b.at);
      work.check();
      // A breath inside the day too: a long day of joined lines is much work on a slow phone.
      for (const [index, point] of points.entries()) {
        work.check();
        walk(point);
        if (index % DAY_STEP === DAY_STEP - 1) await work.pause();
      }
      await work.pause();
    }
    let zoom: number = EXPLORE.zoom;
    // minZoom is not a stop: even there, too many corners means another coarsening.
    while ((await cornersOf(cells, zoom, breath, cancelled)) > EXPLORE.maxCorners) {
      cells = await coarser(cells, zoom, breath, cancelled);
      zoom -= 1;
    }
    const fog = await fogOf(cells, zoom, breath, cancelled);
    const bounds = boundsOfCells(cells, zoom);
    work.check();
    return { fog, bounds, zoom };
  } catch (error) {
    if (error instanceof ExploreCancelled) return null;
    throw error;
  }
}
