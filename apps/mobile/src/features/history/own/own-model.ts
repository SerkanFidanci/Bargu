import { historySlot, type TrailPoint } from '@bargu/schemas';
import { z } from 'zod';

import type { GhostMode } from '../../location/sharing';
import { fromPoint, segments, type TracePoint, withFix } from '../trail-model';
import type { Fix } from '../../location/send';

/**
 * One's own location history (docs/ADR/0030): written only on this phone, from the positions the
 * location engine already takes, never with extra GPS. The rules, the compaction and the file names
 * are here, with no storage and no network, so they can be tested alone.
 */

/** How long a day is kept (docs/ADR/0030 PM kararı 3): 30 days, or a year. */
export const KEEP_CHOICES = [30, 365] as const;
export type KeepDays = (typeof KEEP_CHOICES)[number];

/** The user's choice: off until turned on, the usual keep 30 days. */
export const ownSettingsSchema = z
  .object({ on: z.boolean(), keep: z.union([z.literal(30), z.literal(365)]) })
  .strict();
export type OwnSettings = z.infer<typeof ownSettingsSchema>;
export const OWN_DEFAULT: OwnSettings = { on: false, keep: 30 };

/** What decides whether a position is written (ADR 0030 §1), besides the user's own choice. */
export interface Recording {
  /** Bargu+ or its trial; without it nothing new is written, what is there stays. */
  entitled: boolean;
  ghost: GhostMode;
  /** The location is going to at least one circle now (permission, sharing, not paused). */
  sharing: boolean;
}

/**
 * Whether a position is written down. A ghost writes nothing (not even what the map brings while
 * open), nor does a phone sharing with nobody; a precision coarser than exact is still written, as
 * the coarse trail it is (the screen says "yaklaşık").
 */
export function mayRecord(settings: OwnSettings, state: Recording): boolean {
  return settings.on && state.entitled && state.ghost === 'off' && state.sharing;
}

/**
 * Until when a plan carries the history (Bargu+ or its trial): null when it never ends, 0 for no
 * plan. A payment in grace holds it as long as the grace.
 */
export function entitledUntil(plan: {
  plan: 'free' | 'trial' | 'plus';
  expiresAt: number | null;
  graceUntil: number | null;
  trialEndsAt: number | null;
}): number | null {
  if (plan.plan === 'free') return 0;
  const ends = [plan.expiresAt, plan.graceUntil, plan.plan === 'trial' ? plan.trialEndsAt : null]
    .filter((at): at is number => at !== null)
    .sort((a, b) => b - a)[0];
  return ends ?? null;
}

/** The day a moment falls in as a key: `2026-10-29`, on this phone's clock. */
export function dayKey(at: number): string {
  const day = new Date(at);
  const month = String(day.getMonth() + 1).padStart(2, '0');
  const date = String(day.getDate()).padStart(2, '0');
  return `${String(day.getFullYear())}-${month}-${date}`;
}

/** The month a day key lives in: `2026-10`. One file per month (docs/ADR/0030 §3). */
export function monthOf(day: string): string {
  return day.slice(0, 7);
}

/** The start of a day from its key, on this phone's clock. */
export function dayStartOf(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getTime();
}

/** A compact point: when (ms), latitude and longitude in 1e-5 degrees, accuracy in metres. */
export const dayPointSchema = z.tuple([
  z.number().int(),
  z.number().int().min(-9_000_000).max(9_000_000),
  z.number().int().min(-18_000_000).max(18_000_000),
  z.number().int().min(0).max(10_000),
]);
export type DayPoint = z.infer<typeof dayPointSchema>;
export const dayPointsSchema = z.array(dayPointSchema);

const E5 = 100_000;

export function toDayPoint(point: TracePoint): DayPoint {
  return [
    Math.round(point.at),
    Math.round(point.lat * E5),
    Math.round(point.lng * E5),
    Math.min(10_000, Math.max(0, Math.round(point.acc))),
  ];
}

export function fromDayPoint(point: DayPoint): TracePoint {
  return { at: point[0], lat: point[1] / E5, lng: point[2] / E5, acc: point[3] };
}

/** A quarter hour of points that waits for its day to be compacted: `own:q:<slot>`. */
export const PENDING_PREFIX = 'own:q:';
export const pendingKey = (slot: number) => `${PENDING_PREFIX}${String(slot)}`;

/** The points of a quarter hour with a new position, when it says something new. */
export function withOwnFix(
  points: readonly TrailPoint[],
  fix: Pick<Fix, 'lat' | 'lng' | 'acc' | 'ts'>,
): { slot: number; points: TrailPoint[] } {
  const slot = historySlot(fix.ts);
  return { slot, points: withFix(points, fix, slot) };
}

/** A pending quarter hour back as points of time. */
export function pendingPoints(slot: number, points: readonly TrailPoint[]): TracePoint[] {
  return points.map((point) => fromPoint(point, slot));
}

/**
 * The longest a stay may go without a point once compacted: well under the 45 minutes after which
 * `segments` reads a silence as a gap, so a long stay still reads as one stay.
 */
export const STAY_POINT_EVERY_MS = 30 * 60_000;

/**
 * A day's points made small for keeping (docs/ADR/0030 §3): a stay becomes its entry, its exit and
 * a point every half hour between (so it still reads as one stay); a trip keeps every second point
 * of its way, every fourth while it is long. Reading the compacted day with `segments` gives the
 * same stays, trips and gaps.
 */
export function compactDay(points: readonly TracePoint[]): DayPoint[] {
  const sorted = [...points].sort((a, b) => a.at - b.at);
  const parts = segments(sorted);
  const kept: TracePoint[] = [];
  for (const part of parts) {
    if (part.kind === 'stay') {
      const acc = sorted.find((point) => point.at >= part.from)?.acc ?? 50;
      const at = (when: number): TracePoint => ({ at: when, lat: part.lat, lng: part.lng, acc });
      kept.push(at(part.from));
      for (
        let when = part.from + STAY_POINT_EVERY_MS;
        when < part.to;
        when += STAY_POINT_EVERY_MS
      ) {
        kept.push(at(when));
      }
      kept.push(at(part.to));
    } else if (part.kind === 'move') {
      const path = sorted.filter((point) => point.at > part.from && point.at < part.to);
      const every = path.length > 200 ? 4 : 2;
      for (const [index, point] of path.entries()) {
        if (index % every === 0) kept.push(point);
      }
    }
  }
  return kept.sort((a, b) => a.at - b.at).map(toDayPoint);
}

/** The keys of the days to forget at `now`: older than the keep of the user's choice. */
export function expiredDays(days: readonly string[], now: number, keep: KeepDays): string[] {
  const oldest = new Date(now);
  oldest.setHours(0, 0, 0, 0);
  oldest.setDate(oldest.getDate() - keep + 1);
  const limit = oldest.getTime();
  return days.filter((day) => dayStartOf(day) < limit);
}
