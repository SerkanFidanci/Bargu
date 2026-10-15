import { type AgeBand, type AgeState, ageStateSchema } from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** The account's age band (docs/ADR/0023), read when needed and kept here. */
export const ageKey = ['age'] as const;

export async function fetchAge(): Promise<AgeState> {
  return ageStateSchema.parse(await api.authed('/v1/me/age'));
}

/** Says the band once, or moves to 15-17; older needs a person (403 AGE_REVIEW_REQUIRED). */
export async function setAgeBand(band: AgeBand): Promise<AgeState> {
  return ageStateSchema.parse(
    await api.authed('/v1/me/age', { method: 'PUT', body: { band }, idempotent: true }),
  );
}

export const isMinor = (state: AgeState | undefined) => state?.age?.band === '15-17';
