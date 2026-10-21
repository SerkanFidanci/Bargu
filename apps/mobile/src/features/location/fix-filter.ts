import type { Fix } from './send';
import { distanceM } from './send';

/**
 * Which raw positions this phone uses (docs/ADR/0028), before any circle's precision is applied:
 * a coarse circle still gets its cell of the same position. Rules of thumb from location apps and
 * the platforms' guidance; the numbers are tuned with the preview builds' measurement overlay.
 */
export const FIX_RULES = {
  /**
   * Measured longer ago than this: a cached position, not where the phone is. Generous, because
   * Android hands background positions over through its job scheduler, sometimes late.
   */
  staleMs: 2 * 60_000,
  /** With GPS (an exact location shared somewhere): worse than this is a Wi-Fi or cell guess. */
  goodAccuracyM: 100,
  /**
   * No good position for this long (indoors, a mall): the best one goes anyway, with its accuracy,
   * so friends do not see this phone as old (their map draws it as a circle, without a guess).
   */
  fallbackMs: 45_000,
  /** Faster than this (m/s, 180 km/h) to a spot outside both accuracies: a jump, held back… */
  jumpSpeedMs: 50,
  /**
   * …unless the phone itself says it goes that fast (a high-speed train, a plane): needing no more
   * than its reported speed × this + `reportedSlackMs`, and in about its reported direction. A
   * position GPS made up keeps a low reported speed, or points elsewhere, and is still held back.
   */
  reportedFactor: 1.5,
  reportedSlackMs: 10,
  headingToleranceDeg: 45,
  /** Faster than this (m/s, about the speed of sound) is never believed. */
  maxSpeedMs: 350,
  /** A jump is taken once this many more positions agree with it (the end of a tunnel). */
  confirmations: 2,
} as const;

/** What became of a raw position: used, used as the indoor fallback, or why it was dropped. */
export type FixOutcome = 'taken' | 'fallback' | 'old' | 'stale' | 'inaccurate' | 'jump';

export interface FilterState {
  /** The newest position used (by its own time). */
  taken: Fix | null;
  /** When the last position was used (or the filter started). */
  usedAt: number;
  /** The most accurate of the inaccurate ones since then. */
  best: Fix | null;
  /** Positions held back as a jump, oldest first. */
  suspect: readonly Fix[];
}

export function freshFilter(now: number): FilterState {
  return { taken: null, usedAt: now, best: null, suspect: [] };
}

/** Degrees from north of the way from `a` to `b` (initial great-circle bearing, 0–360). */
function bearing(a: Fix, b: Fix): number {
  const rad = Math.PI / 180;
  const dLng = (b.lng - a.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(b.lat * rad);
  const x =
    Math.cos(a.lat * rad) * Math.sin(b.lat * rad) -
    Math.sin(a.lat * rad) * Math.cos(b.lat * rad) * Math.cos(dLng);
  return (((Math.atan2(y, x) / rad) % 360) + 360) % 360;
}

/** Degrees between two directions (0–180). */
function turn(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * Whether `b` could follow `a`: inside both accuracies, reached at a car's speed, or, faster,
 * at about the speed and in about the direction `b` itself reports (docs/ADR/0028 addendum).
 * Without a valid reported speed only the car's speed counts. (expo-location gives no accuracy
 * for the speed, so its presence and sense are all that can be checked.)
 */
function plausible(a: Fix, b: Fix): boolean {
  const metres = distanceM(a, b);
  if (metres <= a.acc + b.acc) return true;
  const seconds = Math.max((b.ts - a.ts) / 1000, 1);
  const needed = metres / seconds;
  if (needed > FIX_RULES.maxSpeedMs) return false;
  if (needed <= FIX_RULES.jumpSpeedMs) return true;
  const reported = b.spd;
  if (reported === null || !Number.isFinite(reported) || reported < 0) return false;
  if (needed > reported * FIX_RULES.reportedFactor + FIX_RULES.reportedSlackMs) return false;
  const heading = b.hdg;
  if (heading === null || !Number.isFinite(heading)) return true;
  return turn(bearing(a, b), heading) <= FIX_RULES.headingToleranceDeg;
}

function adopt(fix: Fix, now: number, outcome: 'taken' | 'fallback') {
  return { state: { taken: fix, usedAt: now, best: null, suspect: [] }, take: fix, outcome };
}

/**
 * Whether to use a new raw position, and the filter's state after it. In order: not newer than the
 * last one used (the other location source got there first), a cached one, too inaccurate while
 * GPS is on (unless nothing was used for FIX_RULES.fallbackMs: then the best of them), an
 * implausible jump (until confirmed). A position is used whole or not at all, never changed.
 */
export function filterFix(
  state: FilterState,
  fix: Fix,
  now: number,
  gps: boolean,
): { state: FilterState; take: Fix | null; outcome: FixOutcome } {
  if (state.taken !== null && fix.ts <= state.taken.ts) {
    return { state, take: null, outcome: 'old' };
  }
  if (now - fix.ts > FIX_RULES.staleMs) return { state, take: null, outcome: 'stale' };
  if (gps && fix.acc > FIX_RULES.goodAccuracyM) {
    const best =
      state.best === null || now - state.best.ts > FIX_RULES.staleMs || fix.acc < state.best.acc
        ? fix
        : state.best;
    if (now - state.usedAt < FIX_RULES.fallbackMs) {
      return { state: { ...state, best }, take: null, outcome: 'inaccurate' };
    }
    // Indoors for a while: the best one there was, as it is (its accuracy says how rough).
    return adopt(best, now, 'fallback');
  }
  if (state.taken !== null && !plausible(state.taken, fix)) {
    const suspect = [...state.suspect, fix];
    const agreeing = suspect.every((held, index) => {
      const before = suspect[index - 1];
      return before === undefined || plausible(before, held);
    });
    if (agreeing && suspect.length > FIX_RULES.confirmations) return adopt(fix, now, 'taken');
    return {
      state: { ...state, suspect: agreeing ? suspect : [fix] },
      take: null,
      outcome: 'jump',
    };
  }
  return adopt(fix, now, 'taken');
}
