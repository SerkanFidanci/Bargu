import { create } from 'zustand';

import { distanceBetween, type GlidePoint } from './glide';

/** Two people this close (m) have met (BARGU_PLAN §4.3 "buluştunuz"). */
export const MEET_M = 50;
/** They must part this far (m) before meeting again counts as new. */
const PART_M = 150;
/** Only locations at least this precise (m) count: both must share their exact position. */
const EXACT_ACC_M = 100;

/** Who this phone is with right now; the effect plays once when someone joins. */
export const useMeetings = create<{
  together: Record<string, number>;
  /** The latest meeting to celebrate around the user's avatar. */
  burst: { at: number; colors: [string, string] } | null;
}>(() => ({ together: {}, burst: null }));

export interface MeetingInput {
  me: (GlidePoint & { acc: number }) | null;
  /** Others' best locations; `exact` when this phone shares its exact location with them too. */
  others: readonly { userId: string; at: GlidePoint & { acc: number }; exact: boolean }[];
  now: number;
}

/**
 * Updates who is together with this phone and returns the people just met. Nothing leaves the
 * phone: it compares positions it already has. Only when both sides share exact positions (a
 * coarse cell must never trigger "you are 30 m apart").
 */
export function meetings(
  input: MeetingInput,
  together: Readonly<Record<string, number>>,
): { together: Record<string, number>; met: string[] } {
  const next: Record<string, number> = {};
  const met: string[] = [];
  const me = input.me;
  for (const other of input.others) {
    const was = together[other.userId];
    if (me === null || !other.exact || me.acc > EXACT_ACC_M || other.at.acc > EXACT_ACC_M) {
      continue;
    }
    const distance = distanceBetween(me, other.at);
    if (was !== undefined) {
      // Still together until they part clearly (no flicker at the edge).
      if (distance < PART_M) next[other.userId] = was;
    } else if (distance <= MEET_M) {
      next[other.userId] = input.now;
      met.push(other.userId);
    }
  }
  return { together: next, met };
}
