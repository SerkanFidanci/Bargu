import { z } from 'zod';
import { create } from 'zustand';

import type { KeyValueStore } from '../storage/vault';

/**
 * Notifications the user silenced (BARGU_PLAN Faz 7 "kişi/yer bazlı sessize alma"): per person,
 * their arrivals and departures and their pokes; per place, everyone's comings and goings there.
 * Only on this phone: the server never learns who mutes whom.
 */
const mutesSchema = z
  .object({
    people: z.record(z.string(), z.object({ places: z.boolean(), pokes: z.boolean() }).strict()),
    places: z.record(z.string(), z.literal(true)),
  })
  .strict();
export type Mutes = z.infer<typeof mutesSchema>;

export const MUTES_KEY = 'mutes:v1';
export const NO_MUTES: Mutes = { people: {}, places: {} };

export const useMutes = create<Mutes>(() => NO_MUTES);

export function loadMutes(store: KeyValueStore): Mutes {
  const raw = store.get(MUTES_KEY);
  if (raw === undefined) return NO_MUTES;
  const parsed = mutesSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : NO_MUTES;
}

export function saveMutes(store: KeyValueStore, mutes: Mutes): void {
  store.set(MUTES_KEY, JSON.stringify(mutes));
}

/** What someone's notification is about, as far as muting goes. */
export type Mutable = { kind: 'place'; placeId: string } | { kind: 'bump' };

/** Whether this news from that person stays quiet (no banner, no in-app line). */
export function isMuted(mutes: Mutes, about: Mutable, fromUserId: string): boolean {
  const person = mutes.people[fromUserId];
  if (about.kind === 'bump') return person?.pokes === true;
  return person?.places === true || mutes.places[about.placeId] === true;
}

/** The person's switches, with both on when never touched. */
export function personMutes(mutes: Mutes, userId: string): { places: boolean; pokes: boolean } {
  return mutes.people[userId] ?? { places: false, pokes: false };
}

export function withPersonMuted(
  mutes: Mutes,
  userId: string,
  change: Partial<{ places: boolean; pokes: boolean }>,
): Mutes {
  const next = { ...personMutes(mutes, userId), ...change };
  const others = Object.entries(mutes.people).filter(([id]) => id !== userId);
  const people = Object.fromEntries(
    next.places || next.pokes ? [...others, [userId, next] as const] : others,
  );
  return { ...mutes, people };
}

export function withPlaceMuted(mutes: Mutes, placeId: string, muted: boolean): Mutes {
  const others = Object.entries(mutes.places).filter(([id]) => id !== placeId);
  const places = Object.fromEntries(muted ? [...others, [placeId, true] as const] : others);
  return { ...mutes, places };
}
