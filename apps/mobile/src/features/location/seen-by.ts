import type { Circle, MemberCard } from '@bargu/schemas';
import { z } from 'zod';

import type { KeyValueStore } from '../storage/vault';
import { isSharingWith, type SharingSettings } from './sharing';

/**
 * The other active members of every circle this phone was in when last looked at, shared with or
 * not, so that only newcomers count (BARGU_PLAN Faz 9: "yeni izleyicide bildirim").
 */
const KNOWN_KEY = 'location:viewers:v1';
const knownSchema = z.record(z.string(), z.array(z.string()));

const othersIn = (circle: Circle, me: string): MemberCard[] =>
  circle.members.filter((member) => member.userId !== me && member.status === 'active');

export function knownMembers(store: KeyValueStore): Record<string, string[]> {
  const raw = store.get(KNOWN_KEY);
  if (raw === undefined) return {};
  const parsed = knownSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : {};
}

/**
 * People who can see this phone's live location now and could not before ("X artık konumunu
 * görebilir"): newcomers to a group the user shares with right now. Nothing for a circle seen for
 * the first time (just joined), for one not shared with (starting to share there is the user's own
 * choice, made seeing who is in it) or for a friendship (its own notice says so).
 */
export function newLiveViewers(
  known: Readonly<Record<string, readonly string[]>>,
  circles: readonly Circle[],
  settings: SharingSettings,
  me: string,
  now: number,
): { circle: Circle; viewer: MemberCard }[] {
  return circles
    .filter(
      (circle) =>
        circle.kind !== 'pair' &&
        circle.myStatus === 'active' &&
        isSharingWith(settings, circle.id, now),
    )
    .flatMap((circle) => {
      const before = known[circle.id];
      if (before === undefined) return [];
      return othersIn(circle, me)
        .filter((viewer) => !before.includes(viewer.userId))
        .map((viewer) => ({ circle, viewer }));
    });
}

/**
 * Remembers who is in each active circle now. Circles not in this list keep what was known (the
 * list may be partial before the full one arrives); circles left are forgotten with `forget`.
 */
export function rememberMembers(
  store: KeyValueStore,
  circles: readonly Circle[],
  me: string,
): void {
  const now = Object.fromEntries(
    circles
      .filter((circle) => circle.myStatus === 'active')
      .map((circle) => [circle.id, othersIn(circle, me).map((member) => member.userId)]),
  );
  store.set(KNOWN_KEY, JSON.stringify({ ...knownMembers(store), ...now }));
}

/** Forgets the circles this phone is no longer in. */
export function forgetMembers(store: KeyValueStore, isGone: (circleId: string) => boolean): void {
  const known = knownMembers(store);
  const kept = Object.entries(known).filter(([circleId]) => !isGone(circleId));
  if (kept.length !== Object.keys(known).length) {
    store.set(KNOWN_KEY, JSON.stringify(Object.fromEntries(kept)));
  }
}
