import { z } from 'zod';
import { create } from 'zustand';

import type { KeyValueStore } from '../storage/vault';

/**
 * Notifications the user silenced (BARGU_PLAN Faz 7 "kişi/yer bazlı sessize alma"): per person,
 * their arrivals and departures, their pokes and their messages and stories (docs/ADR/0035 §11);
 * per place, everyone's comings and goings there.
 * Only on this phone: the server never learns who mutes whom.
 */
const mutesSchema = z
  .object({
    people: z.record(
      z.string(),
      // `messages` came with docs/ADR/0035: absent in what was saved before, it means not muted.
      z
        .object({ places: z.boolean(), pokes: z.boolean(), messages: z.boolean().optional() })
        .strict(),
    ),
    places: z.record(z.string(), z.literal(true)),
  })
  .strict();
export type Mutes = z.infer<typeof mutesSchema>;

const MUTES_KEY = 'mutes:v1';
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

/** What someone's notification is about, as far as muting goes (lateness: like their comings). */
export type Mutable =
  { kind: 'place'; placeId: string } | { kind: 'bump' } | { kind: 'late' } | { kind: 'message' };

/** Whether this news from that person stays quiet (no banner, no in-app line). */
export function isMuted(mutes: Mutes, about: Mutable, fromUserId: string): boolean {
  const person = mutes.people[fromUserId];
  if (about.kind === 'bump') return person?.pokes === true;
  if (about.kind === 'message') return person?.messages === true;
  if (about.kind === 'late') return person?.places === true;
  return person?.places === true || mutes.places[about.placeId] === true;
}

export interface PersonMutes {
  places: boolean;
  pokes: boolean;
  messages: boolean;
}

/** The person's switches, all on when never touched. */
export function personMutes(mutes: Mutes, userId: string): PersonMutes {
  const person = mutes.people[userId];
  return {
    places: person?.places ?? false,
    pokes: person?.pokes ?? false,
    messages: person?.messages ?? false,
  };
}

/**
 * The person's entry deleted altogether ("Listeden kaldır" for someone no circle is shared with
 * any more: the entry is only their user id and the two flags, and the user may let it go).
 */
export function withoutPersonMuted(mutes: Mutes, userId: string): Mutes {
  return {
    ...mutes,
    people: Object.fromEntries(Object.entries(mutes.people).filter(([id]) => id !== userId)),
  };
}

export function withPersonMuted(mutes: Mutes, userId: string, change: Partial<PersonMutes>): Mutes {
  const { places, pokes, messages } = { ...personMutes(mutes, userId), ...change };
  // `messages` is kept only when on: what was saved before it came reads the same.
  const entry = { places, pokes, ...(messages ? { messages } : {}) };
  const others = Object.entries(mutes.people).filter(([id]) => id !== userId);
  const people = Object.fromEntries(
    places || pokes || messages ? [...others, [userId, entry] as const] : others,
  );
  return { ...mutes, people };
}

export function withPlaceMuted(mutes: Mutes, placeId: string, muted: boolean): Mutes {
  const others = Object.entries(mutes.places).filter(([id]) => id !== placeId);
  const places = Object.fromEntries(muted ? [...others, [placeId, true] as const] : others);
  return { ...mutes, places };
}
