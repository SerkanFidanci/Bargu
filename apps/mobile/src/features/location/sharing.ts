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
    /**
     * Frozen for this circle alone (docs/ADR/0038): its last location stays where it is, no new
     * one goes, and it is not taken back. Absent: not frozen.
     */
    frozen: z.boolean().optional(),
  })
  .strict();
export type CircleSharing = z.infer<typeof circleSharingSchema>;

const sharingSchema = z
  .object({
    /** freeze: others keep the last location; hide: it disappears from their maps. */
    ghost: z.enum(GHOST_MODES),
    circles: z.record(z.string(), circleSharingSchema),
    /**
     * What a circle joined from now on gets: the location (default), or nothing until the user
     * chooses (15-17, docs/ADR/0023).
     */
    newCircles: z.enum(['share', 'off']).optional(),
    /**
     * "Hızımı gösterme" (proje sahibi 2026-10-16, PM): hidden, the speed is dropped before
     * encryption, so the circles see neither it nor what the user moves by. Unset is shown; 15-17
     * starts hidden (applyMinorRules).
     */
    speed: z.enum(['show', 'hide']).optional(),
    /**
     * "Arka planda canlı konum" (docs/ADR/0028 step 3): the user's own choice. Unset follows
     * `backgroundLiveDefault`.
     */
    backgroundLive: z.enum(['on', 'off']).optional(),
    /**
     * What it is without a choice: `on` for 18+, `off` for 15-17 (docs/ADR/0023: for children the
     * default is the most private one). Written when the age band is known, so a phone that has
     * not been told yet has it off.
     */
    backgroundLiveDefault: z.enum(['on', 'off']).optional(),
  })
  .strict();
export type SharingSettings = z.infer<typeof sharingSchema>;

/** Whether this phone's speed goes to its circles. */
export function speedShown(settings: SharingSettings): boolean {
  return settings.speed !== 'hide';
}

/** Joining a circle is agreeing to share with it, at full precision, until changed. */
const DEFAULT_CIRCLE_SHARING: CircleSharing = {
  sharing: true,
  precision: 'exact',
  until: null,
};
export const DEFAULT_SHARING: SharingSettings = { ghost: 'off', circles: {} };

/** Kept on this phone only (encrypted vault): the server never learns these choices. */
const SHARING_KEY = 'sharing:v1';

/** Read leniently: a field a newer version wrote is dropped, not a reason to refuse the rest. */
const circleSharingReadSchema = z.object(circleSharingSchema.shape);

/**
 * Settings that cannot be read send nothing anywhere: a hidden ghost, every circle unshared, a new
 * one too, until the user chooses again (the PM, 2026-10-29: "okunamayan ayar, tam konum demek
 * değildir"; QA-41 O1: what cannot be read is read as its most closed choice).
 */
const NOTHING_READ: SharingSettings = { ghost: 'hide', circles: {}, newCircles: 'off' };

/** One choice as saved: absent stays absent (the default); unreadable is the most closed one. */
function readChoice<T extends string>(
  value: unknown,
  choices: readonly [T, ...T[]],
  closed: T,
  lost: () => void,
): T | undefined {
  if (value === undefined) return undefined;
  const read = z.enum(choices).safeParse(value);
  if (read.success) return read.data;
  lost();
  return closed;
}

/**
 * The saved settings and whether some of them could not be read. A circle whose choice cannot be
 * read gets nothing; settings that cannot be read at all share with nobody. Either way the user is
 * told (`useSharingUnreadable`, LocationBanner).
 */
export function readSharing(store: KeyValueStore): {
  settings: SharingSettings;
  unreadable: boolean;
} {
  const raw = store.get(SHARING_KEY);
  if (raw === undefined) return { settings: DEFAULT_SHARING, unreadable: false };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    // Not even JSON (QA-41 O1: JSON.parse throws a SyntaxError).
    return { settings: NOTHING_READ, unreadable: true };
  }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return { settings: NOTHING_READ, unreadable: true };
  }
  const saved = json as Record<string, unknown>;
  let unreadable = false;
  const lost = () => {
    unreadable = true;
  };
  if (saved.ghost === undefined) lost();
  const ghost = readChoice(saved.ghost, GHOST_MODES, 'hide', lost) ?? 'hide';
  let newCircles = readChoice(saved.newCircles, ['share', 'off'], 'off', lost);
  const circles: Record<string, CircleSharing> = {};
  const entries = saved.circles;
  if (typeof entries !== 'object' || entries === null || Array.isArray(entries)) {
    // Which circles were chosen for is lost: none is shared, nor one joined later.
    unreadable = true;
    newCircles = 'off';
  } else {
    for (const [circleId, entry] of Object.entries(entries)) {
      const circle = circleSharingReadSchema.safeParse(entry);
      if (circle.success) {
        circles[circleId] = circle.data;
      } else {
        circles[circleId] = NOT_SHARED;
        unreadable = true;
      }
    }
  }
  const speed = readChoice(saved.speed, ['show', 'hide'], 'hide', lost);
  const backgroundLive = readChoice(saved.backgroundLive, ['on', 'off'], 'off', lost);
  const backgroundLiveDefault = readChoice(saved.backgroundLiveDefault, ['on', 'off'], 'off', lost);
  const settings = {
    ghost,
    circles,
    ...(newCircles === undefined ? {} : { newCircles }),
    ...(speed === undefined ? {} : { speed }),
    ...(backgroundLive === undefined ? {} : { backgroundLive }),
    ...(backgroundLiveDefault === undefined ? {} : { backgroundLiveDefault }),
  };
  // What was read, checked whole as it is written: anything else is read closed.
  const checked = sharingSchema.safeParse(settings);
  return checked.success
    ? { settings: checked.data, unreadable }
    : { settings: NOTHING_READ, unreadable: true };
}

export function loadSharing(store: KeyValueStore): SharingSettings {
  return readSharing(store).settings;
}

/** Some of the saved settings could not be read this run: the map says so until looked at. */
export const useSharingUnreadable = create<{ unreadable: boolean }>(() => ({
  unreadable: false,
}));

export function saveSharing(store: KeyValueStore, settings: SharingSettings): void {
  store.set(SHARING_KEY, JSON.stringify(settings));
}

/** A circle the user has not chosen for yet, when new circles start unshared. */
const NOT_SHARED: CircleSharing = { sharing: false, precision: 'exact', until: null };

export function circleSharing(settings: SharingSettings, circleId: string): CircleSharing {
  return (
    settings.circles[circleId] ??
    (settings.newCircles === 'off' ? NOT_SHARED : DEFAULT_CIRCLE_SHARING)
  );
}

/**
 * 15-17 (docs/ADR/0023): a circle joined from now on starts unshared, and the user turns it on.
 * The circles already shared with stay as they are: their current choice is written down first.
 */
export function withNewCirclesOff(
  settings: SharingSettings,
  circleIds: readonly string[],
): SharingSettings {
  if (settings.newCircles === 'off') return settings;
  const circles = { ...settings.circles };
  for (const id of circleIds) circles[id] ??= circleSharing(settings, id);
  return { ...settings, circles, newCircles: 'off' };
}

/**
 * Everything 15-17 starts with on this phone (docs/ADR/0023): new circles unshared, and the speed
 * hidden unless the user already chose ("Hızımı gösterme"). Done once: later choices stay.
 */
export function withMinorSharing(
  settings: SharingSettings,
  circleIds: readonly string[],
): SharingSettings {
  // The first time these rules apply, a choice made before (as an adult) is not carried over.
  const first = settings.newCircles !== 'off';
  const next = withNewCirclesOff(settings, circleIds);
  const withSpeed = next.speed === undefined ? { ...next, speed: 'hide' as const } : next;
  // Background live is off for 15-17 unless the teen turns it on (docs/ADR/0028 step 3).
  if (!first && withSpeed.backgroundLiveDefault === 'off') return withSpeed;
  const { backgroundLive: chosen, ...rest } = withSpeed;
  return {
    ...rest,
    ...(first || chosen === undefined ? {} : { backgroundLive: chosen }),
    backgroundLiveDefault: 'off',
  };
}

/**
 * Background live mode (docs/ADR/0028 step 3) is on for this phone: the user's choice, else the
 * default of the age band (on for 18+, off for 15-17), else off. Whatever is not known is off.
 */
export function backgroundLiveOn(settings: SharingSettings): boolean {
  return (settings.backgroundLive ?? settings.backgroundLiveDefault ?? 'off') === 'on';
}

/** 18+: background live starts on, unless this phone already has a default (a teen's stays off). */
export function withAdultDefaults(settings: SharingSettings): SharingSettings {
  return settings.backgroundLiveDefault === undefined
    ? { ...settings, backgroundLiveDefault: 'on' }
    : settings;
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

/**
 * What a circle sees of this phone right now: the live location, the history being written. A
 * ghost or a paused circle sees neither, history switch or not (QA Faz 9 3a-B5: the iOS list and
 * the "joined" notice went by the switch alone).
 */
export interface SeenThere {
  location: boolean;
  history: boolean;
}

export function seenThere(settings: SharingSettings, circleId: string, now: number): SeenThere {
  return {
    location: isSharingWith(settings, circleId, now),
    history: historyOn(settings, circleId, now),
  };
}

/** Whether this phone sends its location to a circle right now. */
export function isSharingWith(settings: SharingSettings, circleId: string, now: number): boolean {
  if (settings.ghost !== 'off') return false;
  const sharing = circleSharing(settings, circleId);
  return (
    sharing.sharing && sharing.frozen !== true && (sharing.until === null || sharing.until > now)
  );
}

/**
 * Whether a circle's timed share ran out (not turned off, not a ghost): the moment a friendship is
 * told so (docs/ADR/0038 Ek 1).
 */
export function timedShareOver(settings: SharingSettings, circleId: string, now: number): boolean {
  if (settings.ghost !== 'off') return false;
  const sharing = circleSharing(settings, circleId);
  return sharing.sharing && sharing.until !== null && sharing.until <= now;
}

/**
 * Which of the circles whose location is being taken back are told their timed share ended
 * (docs/ADR/0038 Ek 1, Ek 2): friendships whose time ran out, and nothing else. A freeze is silent
 * and says no reason; "Gösterme", a ghost or a pause say nothing either (the PM, 2026-10-29).
 */
export function timedEnds<T extends { id: string; kind?: string | undefined }>(
  circles: readonly T[],
  settings: SharingSettings,
  circleIds: readonly string[],
  now: number,
): { circle: T; until: number }[] {
  const ends: { circle: T; until: number }[] = [];
  for (const circle of circles) {
    const sharing = circleSharing(settings, circle.id);
    if (circle.kind !== 'pair' || !circleIds.includes(circle.id)) continue;
    if (sharing.frozen === true || sharing.until === null) continue;
    if (!timedShareOver(settings, circle.id, now)) continue;
    ends.push({ circle, until: sharing.until });
  }
  return ends;
}

/**
 * Whether a circle keeps this phone's last location without new ones, frozen for it alone
 * (docs/ADR/0038): so it is not taken back while its share lasts. A ghost is above it all.
 */
export function isFrozenFor(settings: SharingSettings, circleId: string, now: number): boolean {
  if (settings.ghost !== 'off') return false;
  const sharing = circleSharing(settings, circleId);
  return (
    sharing.sharing && sharing.frozen === true && (sharing.until === null || sharing.until > now)
  );
}

/**
 * Active circles this phone sends to now: none while a ghost, and none that nobody keeps open
 * (paused, docs/ADR/0024: its live location waits until someone has Bargu+).
 */
export function sharedCircles<
  T extends Pick<Circle, 'id' | 'myStatus'> & { paused?: boolean | undefined },
>(circles: readonly T[], settings: SharingSettings, now: number): T[] {
  return circles.filter(
    (circle) =>
      circle.myStatus === 'active' &&
      circle.paused !== true &&
      isSharingWith(settings, circle.id, now),
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
