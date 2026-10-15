import {
  HISTORY_DAYS,
  HISTORY_KEEP_MS,
  HISTORY_SLOT_MS,
  historySlot,
  MAX_TRAIL_POINTS,
  type TrailPoint,
} from '@bargu/schemas';

import { distanceM, type Fix } from '../location/send';
import { activityFx } from '@/theme/motion';

/** How a trail is written down on the phone (docs/ADR/0019). */
export const TRAIL = {
  /** A new point once this far from the last one kept… */
  stepM: 25,
  /** …or this long after it, so a stay shows as a few points rather than none. */
  everyMs: 5 * 60_000,
  /** Positions vaguer than this are left out, unless the quarter hour has nothing yet. */
  maxAccuracyM: 100,
} as const;

/** A point back in plain numbers: when, where, how precise. */
export interface TracePoint {
  at: number;
  lat: number;
  lng: number;
  acc: number;
}

const E5 = 100_000;

/** A position as a point of its quarter hour (seconds into it, about a metre of precision). */
export function toPoint(fix: Pick<Fix, 'lat' | 'lng' | 'acc' | 'ts'>, slot: number): TrailPoint {
  const seconds = Math.min(HISTORY_SLOT_MS / 1000, Math.max(0, Math.round((fix.ts - slot) / 1000)));
  return [
    seconds,
    Math.round(fix.lat * E5),
    Math.round(fix.lng * E5),
    Math.min(10_000, Math.max(0, Math.round(fix.acc))),
  ];
}

export function fromPoint(point: TrailPoint, slot: number): TracePoint {
  return { at: slot + point[0] * 1000, lat: point[1] / E5, lng: point[2] / E5, acc: point[3] };
}

/** Fewer points, the same shape: every other one between the first and the last goes. */
export function thin(points: readonly TrailPoint[]): TrailPoint[] {
  return points.filter((_, index) => index === 0 || index === points.length - 1 || index % 2 === 0);
}

/** The quarter hour's points with a new position, when it says something new. */
export function withFix(
  points: readonly TrailPoint[],
  fix: Pick<Fix, 'lat' | 'lng' | 'acc' | 'ts'>,
  slot: number,
): TrailPoint[] {
  const last = points.at(-1);
  if (last !== undefined) {
    if (fix.acc > TRAIL.maxAccuracyM) return [...points];
    const held = fromPoint(last, slot);
    const near = distanceM(held, fix) < TRAIL.stepM;
    if (near && fix.ts - held.at < TRAIL.everyMs) return [...points];
  }
  const next = [...points, toPoint(fix, slot)];
  return next.length > MAX_TRAIL_POINTS ? thin(next) : next;
}

/** A quarter hour of trail for one circle: written while shared, then sent. */
export interface Piece {
  circleId: string;
  slot: number;
  /** The circle's epoch when it began: it is sealed for the members of then. */
  epoch: number;
  points: TrailPoint[];
}

/** Circles a position is written down for: their epoch now. */
export interface TrailCircle {
  id: string;
  epoch: number;
}

/**
 * The pieces being written after a new position: those of an earlier quarter hour, or of circles
 * no longer getting the history, are finished (to send); the circles that get it now have the
 * position added to theirs.
 */
export function recordFix(
  open: Readonly<Record<string, Piece>>,
  fix: Pick<Fix, 'lat' | 'lng' | 'acc' | 'ts'>,
  circles: readonly TrailCircle[],
): { open: Record<string, Piece>; finished: Piece[] } {
  const slot = historySlot(fix.ts);
  const sharing = new Set(circles.map((circle) => circle.id));
  const finished = Object.values(open).filter(
    (piece) => (piece.slot < slot || !sharing.has(piece.circleId)) && piece.points.length > 0,
  );
  const next: Record<string, Piece> = {};
  for (const circle of circles) {
    const held = open[circle.id];
    const piece =
      held?.slot === slot ? held : { circleId: circle.id, slot, epoch: circle.epoch, points: [] };
    next[circle.id] = { ...piece, points: withFix(piece.points, fix, slot) };
  }
  return { open: next, finished };
}

/** Finished pieces once their quarter hour is over, even without a new position. */
export function closeDue(
  open: Readonly<Record<string, Piece>>,
  now: number,
): { open: Record<string, Piece>; finished: Piece[] } {
  const current = historySlot(now);
  const entries = Object.entries(open);
  return {
    open: Object.fromEntries(entries.filter(([, piece]) => piece.slot >= current)),
    finished: entries
      .map(([, piece]) => piece)
      .filter((piece) => piece.slot < current && piece.points.length > 0),
  };
}

/** Whether a piece is still worth sending (the server keeps two weeks). */
export function stillKept(piece: Pick<Piece, 'slot'>, now: number): boolean {
  return piece.slot >= now - HISTORY_KEEP_MS + HISTORY_SLOT_MS;
}

/** What someone did over a day, as a timeline. */
export type Segment =
  | { kind: 'stay'; from: number; to: number; lat: number; lng: number }
  | {
      kind: 'move';
      from: number;
      to: number;
      meters: number;
      mode: 'walk' | 'bike' | 'vehicle';
    }
  | { kind: 'gap'; from: number; to: number };

/** Reading a day's points into stays and trips. */
export const SEGMENTS = {
  /** Within this of where they stopped… */
  stayRadiusM: 150,
  /** …for at least this long is a stay. */
  stayMinMs: 5 * 60_000,
  /** No point for this long: nothing is known in between. */
  gapMs: 45 * 60_000,
} as const;

/** How someone travelled: the speed they kept up most of the way (the app's activity speeds). */
function modeOf(points: readonly TracePoint[]): 'walk' | 'bike' | 'vehicle' {
  const speeds = points
    .slice(1)
    .map((point, index) => {
      const before = points[index];
      if (before === undefined || point.at <= before.at) return 0;
      return (distanceM(before, point) / (point.at - before.at)) * 1000;
    })
    .sort((a, b) => a - b);
  const kept = speeds[Math.floor(speeds.length * 0.8)] ?? 0;
  const { bike, drive } = activityFx.speeds;
  if (kept >= drive) return 'vehicle';
  return kept >= bike ? 'bike' : 'walk';
}

function travelled(points: readonly TracePoint[]): number {
  let meters = 0;
  for (let index = 1; index < points.length; index++) {
    const before = points[index - 1];
    const point = points[index];
    if (before !== undefined && point !== undefined) meters += distanceM(before, point);
  }
  return Math.round(meters);
}

/**
 * A day's points as stays (within 150 m for at least 5 minutes, where they were), trips between
 * them (how far, how) and gaps (no point for three quarters of an hour), in time order.
 */
export function segments(points: readonly TracePoint[]): Segment[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const result: Segment[] = [];
  let moving: TracePoint[] = [];
  let index = 0;
  const closeMove = (until: TracePoint | undefined) => {
    const path = until === undefined ? moving : [...moving, until];
    const first = path[0];
    const last = path.at(-1);
    if (first !== undefined && last !== undefined && last.at > first.at) {
      result.push({
        kind: 'move',
        from: first.at,
        to: last.at,
        meters: travelled(path),
        mode: modeOf(path),
      });
    }
    moving = [];
  };
  while (index < sorted.length) {
    const start = sorted[index];
    if (start === undefined) break;
    // How far a stay from here would reach.
    let end = index;
    for (let next = index + 1; next < sorted.length; next++) {
      const point = sorted[next];
      const before = sorted[next - 1];
      if (point === undefined || before === undefined) break;
      if (point.at - before.at > SEGMENTS.gapMs) break;
      if (distanceM(start, point) > SEGMENTS.stayRadiusM) break;
      end = next;
    }
    const last = sorted[end];
    const after = sorted[end + 1];
    if (last !== undefined && last.at - start.at >= SEGMENTS.stayMinMs) {
      closeMove(start);
      const span = sorted.slice(index, end + 1);
      result.push({
        kind: 'stay',
        from: start.at,
        to: last.at,
        lat: span.reduce((sum, point) => sum + point.lat, 0) / span.length,
        lng: span.reduce((sum, point) => sum + point.lng, 0) / span.length,
      });
      moving = [last];
    } else {
      moving.push(...sorted.slice(index, end + 1));
    }
    if (after !== undefined && last !== undefined && after.at - last.at > SEGMENTS.gapMs) {
      closeMove(undefined);
      result.push({ kind: 'gap', from: last.at, to: after.at });
    }
    index = end + 1;
  }
  closeMove(undefined);
  return result;
}

/** The start of the day a moment falls in, on this phone's clock. */
export function dayStart(at: number): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/** The days history can show, today first, as far back as the server keeps it. */
export function historyDays(now: number): number[] {
  const today = dayStart(now);
  return Array.from({ length: HISTORY_DAYS }, (_, back) => {
    const day = new Date(today);
    day.setDate(day.getDate() - back);
    return day.getTime();
  });
}
