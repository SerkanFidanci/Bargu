import type { PrecisionLevel } from '@bargu/crypto';
import type { Circle } from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyValueStore } from '../storage/vault';

export const PRECISIONS = [
  'exact',
  'neighborhood',
  'city',
] as const satisfies readonly PrecisionLevel[];
export const GHOST_MODES = ['off', 'freeze', 'hide'] as const;
export type GhostMode = (typeof GHOST_MODES)[number];

const circleSharingSchema = z
  .object({
    sharing: z.boolean(),
    precision: z.enum(PRECISIONS),
    /** Sharing ends at this time (Unix ms); null: until turned off. */
    until: z.number().int().nullable(),
    /**
     * Location history for the circle (docs/ADR/0019). Off until the user turns it on: joining a
     * circle is not consent to history (BARGU_PLAN).
     */
    history: z.boolean().optional(),
  })
  .strict();
export type CircleSharing = z.infer<typeof circleSharingSchema>;

const sharingSchema = z
  .object({
    /** freeze: others keep the last location; hide: it disappears from their maps. */
    ghost: z.enum(GHOST_MODES),
    circles: z.record(z.string(), circleSharingSchema),
  })
  .strict();
export type SharingSettings = z.infer<typeof sharingSchema>;

/** Joining a circle is agreeing to share with it, at full precision, until changed. */
export const DEFAULT_CIRCLE_SHARING: CircleSharing = {
  sharing: true,
  precision: 'exact',
  until: null,
};
export const DEFAULT_SHARING: SharingSettings = { ghost: 'off', circles: {} };

/** Kept on this phone only (encrypted vault): the server never learns these choices. */
export const SHARING_KEY = 'sharing:v1';

export function loadSharing(store: KeyValueStore): SharingSettings {
  const raw = store.get(SHARING_KEY);
  if (raw === undefined) return DEFAULT_SHARING;
  const parsed = sharingSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : DEFAULT_SHARING;
}

export function saveSharing(store: KeyValueStore, settings: SharingSettings): void {
  store.set(SHARING_KEY, JSON.stringify(settings));
}

export function circleSharing(settings: SharingSettings, circleId: string): CircleSharing {
  return settings.circles[circleId] ?? DEFAULT_CIRCLE_SHARING;
}

/**
 * Whether this phone writes down its history for a circle now (docs/ADR/0019): the user turned it
 * on for that circle, and its exact location goes there.
 */
export function historyOn(settings: SharingSettings, circleId: string, now: number): boolean {
  const sharing = circleSharing(settings, circleId);
  return (
    isSharingWith(settings, circleId, now) &&
    sharing.precision === 'exact' &&
    sharing.history === true
  );
}

/**
 * The choices without those of circles this phone is no longer in (left, removed, an event over):
 * coming back starts afresh, location history off (joining again is not consent, QA Faz 8 W4).
 */
export function withoutGoneCircles(
  settings: SharingSettings,
  isGone: (circleId: string) => boolean,
): SharingSettings {
  return {
    ...settings,
    circles: Object.fromEntries(
      Object.entries(settings.circles).filter(([circleId]) => !isGone(circleId)),
    ),
  };
}

/** Whether this phone sends its location to a circle right now. */
/** What a circle sees of this phone: the live location right now, the location history. */
export interface SeenThere {
  location: boolean;
  history: boolean;
}

export function seenThere(settings: SharingSettings, circleId: string, now: number): SeenThere {
  return {
    location: isSharingWith(settings, circleId, now),
    history: circleSharing(settings, circleId).history === true,
  };
}

export function isSharingWith(settings: SharingSettings, circleId: string, now: number): boolean {
  if (settings.ghost !== 'off') return false;
  const sharing = circleSharing(settings, circleId);
  return sharing.sharing && (sharing.until === null || sharing.until > now);
}

/** Active circles this phone sends to now (none while a ghost). */
export function sharedCircles<T extends Pick<Circle, 'id' | 'myStatus'>>(
  circles: readonly T[],
  settings: SharingSettings,
  now: number,
): T[] {
  return circles.filter(
    (circle) => circle.myStatus === 'active' && isSharingWith(settings, circle.id, now),
  );
}

/**
 * Whether any circle gets full precision: only then is GPS worth its battery. Neighbourhood and
 * city cells (1 and 10 km) are well served by Wi-Fi and cell positioning.
 */
export function needsGps(
  circles: readonly Pick<Circle, 'id' | 'myStatus'>[],
  settings: SharingSettings,
  now: number,
): boolean {
  return sharedCircles(circles, settings, now).some(
    (circle) => circleSharing(settings, circle.id).precision === 'exact',
  );
}

/** "Who sees me": everyone active in a circle this phone shares with (BARGU_PLAN §4.1). */
/** Who sees this phone's location right now, circle by circle (the "Seni görenler" screen). */
export function seersByCircle(
  circles: readonly Circle[],
  settings: SharingSettings,
  me: string,
  now: number,
): { circle: Circle; seers: Circle['members'] }[] {
  return sharedCircles(circles, settings, now)
    .map((circle) => ({
      circle,
      seers: circle.members.filter((member) => member.userId !== me && member.status === 'active'),
    }))
    .filter(({ seers }) => seers.length > 0);
}

export function seersOf(
  circles: readonly Circle[],
  settings: SharingSettings,
  me: string | null,
  now: number,
) {
  const seen = new Map<string, Circle['members'][number]>();
  for (const circle of sharedCircles(circles, settings, now)) {
    for (const member of circle.members) {
      if (member.userId !== me && member.status === 'active') seen.set(member.userId, member);
    }
  }
  return [...seen.values()];
}

/** End of today in the phone's time zone (timed sharing "until tonight"). */
export function endOfDay(now: number): number {
  const date = new Date(now);
  date.setHours(23, 59, 59, 999);
  return date.getTime();
}

/** The settings as the screens see them; changed only through `updateSharing` (live-session). */
export const useSharing = create<SharingSettings>(() => DEFAULT_SHARING);

/**
 * A reinstalled app (or a new phone) knows none of the user's earlier choices, which stayed only
 * on the old phone. Rather than the default (full precision to every circle), it starts sharing
 * with none of the circles the account is already in, until the user chooses again.
 */
export function withNothingShared(
  settings: SharingSettings,
  circleIds: readonly string[],
): SharingSettings {
  const circles = { ...settings.circles };
  for (const id of circleIds) {
    circles[id] ??= { sharing: false, precision: 'exact', until: null };
  }
  return { ...settings, circles };
}

/** "Share with all of them": every listed circle gets the full location again, without end. */
export function withAllShared(
  settings: SharingSettings,
  circleIds: readonly string[],
): SharingSettings {
  const circles = { ...settings.circles };
  for (const id of circleIds) circles[id] = { sharing: true, precision: 'exact', until: null };
  return { ...settings, circles };
}

/** Whether to ask the user to choose again what each circle gets (see withNothingShared). */
export const useSharingReview = create<{ pending: boolean }>(() => ({ pending: false }));
export const SHARING_REVIEW_KEY = 'sharing:review:v1';
