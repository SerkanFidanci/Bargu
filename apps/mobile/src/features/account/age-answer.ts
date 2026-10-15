import type { AgeBand } from '@bargu/schemas';
import { create } from 'zustand';

/** "Kaç yaşındasın?" (docs/ADR/0023): a band, or under 15 (no account then). */
export type AgeAnswer = AgeBand | 'under15';

/**
 * The answer given before signing in (the first screens have no account yet): sent with the code,
 * so that a new account opens with its band. Kept in memory only.
 */
export const useAgeAnswer = create<{ answer: AgeAnswer | null }>(() => ({ answer: null }));

/** The band to send with the code, if one was chosen. */
export function answeredBand(): AgeBand | undefined {
  const { answer } = useAgeAnswer.getState();
  return answer === null || answer === 'under15' ? undefined : answer;
}
