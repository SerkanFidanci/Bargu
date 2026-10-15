import type { Circle, MemberCard } from '@bargu/schemas';
import { z } from 'zod';

import { circleSharing, type SharingSettings } from '../location/sharing';
import type { KeyValueStore } from '../storage/vault';

/** A circle that gets this phone's history, and the people who can see it there. */
export interface HistoryAudience {
  circle: Circle;
  viewers: MemberCard[];
}

/**
 * "Geçmişimi kim görüyor" (BARGU_PLAN, docs/ADR/0019): every circle the user turned history on for,
 * with its other active members, who see it from when they joined. Paused sharing does not hide a
 * circle here: what it already has stays visible to it.
 */
export function historyAudience(
  circles: readonly Circle[],
  settings: SharingSettings,
  me: string,
): HistoryAudience[] {
  return circles
    .filter(
      (circle) =>
        circle.myStatus === 'active' && circleSharing(settings, circle.id).history === true,
    )
    .map((circle) => ({
      circle,
      viewers: circle.members.filter(
        (member) => member.userId !== me && member.status === 'active',
      ),
    }));
}

/** Who could see the history per circle when last looked at (to tell about newcomers). */
const KNOWN_KEY = 'history:viewers:v1';
const knownSchema = z.record(z.string(), z.array(z.string()));

export function knownViewers(store: KeyValueStore): Record<string, string[]> {
  const raw = store.get(KNOWN_KEY);
  if (raw === undefined) return {};
  const parsed = knownSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : {};
}

/**
 * People who can see the history now and could not before ("artık X de geçmişini görebilir"). A
 * circle seen for the first time (history just turned on) tells nothing: those were already there
 * when the user chose.
 */
export function newViewers(
  known: Readonly<Record<string, readonly string[]>>,
  audience: readonly HistoryAudience[],
): { circle: Circle; viewer: MemberCard }[] {
  return audience.flatMap(({ circle, viewers }) => {
    const before = known[circle.id];
    if (before === undefined) return [];
    return viewers
      .filter((viewer) => !before.includes(viewer.userId))
      .map((viewer) => ({ circle, viewer }));
  });
}

/** Remembers who can see the history now. */
export function rememberViewers(store: KeyValueStore, audience: readonly HistoryAudience[]): void {
  store.set(
    KNOWN_KEY,
    JSON.stringify(
      Object.fromEntries(
        audience.map(({ circle, viewers }) => [circle.id, viewers.map((viewer) => viewer.userId)]),
      ),
    ),
  );
}

/** One circle's audience from now on (history turned on), or none (turned off). */
export function setKnownViewers(
  store: KeyValueStore,
  circleId: string,
  viewers: readonly string[] | null,
): void {
  const known = Object.entries(knownViewers(store)).filter(([id]) => id !== circleId);
  store.set(
    KNOWN_KEY,
    JSON.stringify(Object.fromEntries(viewers === null ? known : [...known, [circleId, viewers]])),
  );
}
