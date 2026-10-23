import { type DeviceKeys, encryptMessage } from '@bargu/crypto';
import type {
  Circle,
  DevicePushes,
  LocPayload,
  PlaceEventRequest,
  PlanPayload,
  PushBody,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyStore } from '../keys/key-store';
import type { Fix } from '../location/send';
import type { SharingSettings } from '../location/sharing';
import { activityOf } from '../map/activity';
import type { PushContacts } from '../notifications/push-contacts';
import type { Place } from '../places/place-model';
import { announcesTo, sealPushes } from '../places/presence';
import type { KeyValueStore } from '../storage/vault';
import { docKey } from './docs';
import {
  approachRate,
  type Doc,
  distanceTo,
  estimateArrival,
  inEtaWindow,
  lateIsNews,
  lateMinutes,
  leaveReminderAt,
  MEETING,
  type Progress,
  PROGRESS,
  type TravelMode,
  withProgress,
} from './plan-model';

/** An event's meeting once both its time and its place are known. */
export interface Meeting {
  circleId: string;
  meetAt: number;
  place: Place;
}

/** The icon of a spot picked on the map for a meeting. */
export const SPOT_EMOJI = '📍';

/**
 * Where a meeting is: one of the circle's saved places, or the spot picked on the map for it,
 * kept inside the meeting (docs/ADR/0026 Ek 1). A spot reads as a place named by the meeting
 * (its id is the circle's), so the map, the board and the estimates treat both alike.
 */
export function meetingPlace(
  plan: PlanPayload,
  places: Readonly<Record<string, Place>>,
): Place | undefined {
  if (plan.spot !== undefined) {
    return {
      id: plan.id,
      circleId: plan.id,
      version: 0,
      name: plan.spot.name,
      emoji: SPOT_EMOJI,
      lat: plan.spot.lat,
      lng: plan.spot.lng,
      radius: plan.spot.radius,
      ts: plan.ts,
    };
  }
  return plan.placeId === undefined ? undefined : places[plan.placeId];
}

/** The meeting of an event from its documents and places; null while time or place is open. */
export function meetingOf(
  circleId: string,
  docs: Readonly<Record<string, Doc>>,
  places: Readonly<Record<string, Place>>,
): Meeting | null {
  const plan = docs[docKey(circleId, circleId)]?.payload;
  if (plan?.kind !== 'plan' || plan.meetAt === undefined) return null;
  const place = meetingPlace(plan, places);
  if (place?.circleId !== circleId) return null;
  return { circleId, meetAt: plan.meetAt, place };
}

/** "I will be about this late", for the event: the message, and notifications for the others. */
export function lateEvent(input: {
  circle: Pick<Circle, 'id' | 'epoch'>;
  meetAt: number;
  minutes: number;
  keys: KeyStore;
  device: DeviceKeys;
  recipients: PushContacts['recipients'][string];
  now: number;
}): PlaceEventRequest {
  const { circle, meetAt, minutes, keys, device, now } = input;
  const envelope = encryptMessage({
    state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
    sender: device,
    payload: { kind: 'late', meetAt, minutes, ts: now },
  }).envelope;
  const body: PushBody = { kind: 'late', circleId: circle.id, minutes, ts: now };
  return { envelope, pushes: sealPushes(input.recipients, device, body) };
}

/**
 * "Geldim" (docs/ADR/0026 §5): the message for the members who are online; no notifications.
 * A coarse location never tells an arrival, so the person may say it.
 */
export function arrivedEvent(input: {
  circle: Pick<Circle, 'id' | 'epoch'>;
  meetAt: number;
  keys: KeyStore;
  device: DeviceKeys;
  now: number;
}): PlaceEventRequest {
  const { circle, meetAt, keys, device, now } = input;
  const envelope = encryptMessage({
    state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
    sender: device,
    payload: { kind: 'arrived', meetAt, ts: now },
  }).envelope;
  return { envelope, pushes: [] };
}

/**
 * "X started a meeting: 17:30 · Ev" (docs/ADR/0026 §6), sealed for each trusted member's device;
 * the server hands them only to the members whose app is not connected.
 */
export function meetingStartPushes(input: {
  circleId: string;
  place: Pick<Place, 'name' | 'emoji'>;
  meetAt: number;
  device: DeviceKeys;
  recipients: PushContacts['recipients'][string];
  now: number;
}): DevicePushes {
  const body: PushBody = {
    kind: 'meeting',
    circleId: input.circleId,
    name: input.place.name,
    emoji: input.place.emoji,
    meetAt: input.meetAt,
    ts: input.now,
  };
  return sealPushes(input.recipients, input.device, body);
}

/** Who said "Geldim", per `${circleId}:${userId}` (memory only: the board shows it). */
export const useArrived = create<Record<string, { meetAt: number; ts: number }>>(() => ({}));

/** Lateness others told, per `${circleId}:${userId}` (memory only: the board shows it). */
export const useLates = create<Record<string, { meetAt: number; minutes: number; ts: number }>>(
  () => ({}),
);

/** This phone's own choices per event: how it travels there, whether to remind it to leave. */
const CHOICES_KEY = 'meeting:choices:v1';
const choicesSchema = z.record(
  z.string(),
  z
    .object({
      mode: z.enum(['walk', 'bike', 'vehicle']).optional(),
      remind: z.boolean().optional(),
    })
    .strict(),
);
export type MeetingChoices = z.infer<typeof choicesSchema>;
export const useMeetingChoices = create<MeetingChoices>(() => ({}));

/**
 * Per `${circleId}:${meetAt}`: the lateness already told, and since when the estimate has said
 * "late" (told only once it held a few minutes). Per event: the reminder set, and how this phone
 * got closer over the last minutes (PROGRESS).
 */
const TOLD_KEY = 'meeting:told:v1';
const LATE_SINCE_KEY = 'meeting:late-since:v1';
const REMINDERS_KEY = 'meeting:reminders:v1';
const TRACKS_KEY = 'meeting:tracks:v1';
const toldSchema = z.record(z.string(), z.number());
const tracksSchema = z.record(
  z.string(),
  z
    .object({
      meetAt: z.number(),
      placeId: z.string(),
      track: z.array(z.object({ ts: z.number(), remaining: z.number() }).strict()),
    })
    .strict(),
);
const remindersSchema = z.record(
  z.string(),
  z
    .object({
      meetAt: z.number(),
      placeId: z.string(),
      remindAt: z.number(),
      /** Metres still to go when it was set: moving well closer means they are on their way. */
      distance: z.number(),
      done: z.boolean(),
    })
    .strict(),
);
type Reminders = z.infer<typeof remindersSchema>;

export interface ReminderText {
  title: string;
  body: string;
}

export interface MeetingDeps {
  /** The circles as sending knows them (a background start has only the vault copy). */
  circles: () => readonly (Pick<Circle, 'id' | 'epoch' | 'myStatus'> & {
    kind?: Circle['kind'] | undefined;
    /** A paused circle (docs/ADR/0024 §3) takes no "will be late" (QA 21 B-4). */
    paused?: boolean | undefined;
  })[];
  docs: () => Readonly<Record<string, Doc>>;
  places: () => Readonly<Record<string, Place>>;
  sharing: () => SharingSettings;
  store: () => KeyValueStore;
  /** Tells the event this phone will be late; throws when it did not get there. */
  sendLate: (
    circle: Pick<Circle, 'id' | 'epoch'>,
    meetAt: number,
    minutes: number,
  ) => Promise<void>;
  /** A local notification at `at` (replacing this event's earlier one), or now when `at` is null. */
  remind: (circleId: string, at: number | null, text: ReminderText) => Promise<void>;
  cancel: (circleId: string) => Promise<void>;
  /** The reminder's words: leave within `minutes` for this meeting. */
  words: (meeting: Meeting, minutes: number) => ReminderText;
  now?: () => number;
}

function read<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>, empty: T): T {
  const raw = store.get(key);
  if (raw === undefined) return empty;
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : empty;
}

/**
 * The meeting of each event on this phone (docs/ADR/0018), worked out from its own positions:
 * when it will be there (sent with its location, exact sharing only), "I will be late" to the
 * others once it is clearly late (again only when that grows), and a local reminder a quarter of
 * an hour before it has to leave. Estimates stay on the phone: no routing service is asked.
 */
export function createMeetings(deps: MeetingDeps) {
  const now = deps.now ?? Date.now;
  let choicesLoaded = false;

  function choices(): MeetingChoices {
    if (!choicesLoaded) {
      useMeetingChoices.setState(read(deps.store(), CHOICES_KEY, choicesSchema, {}), true);
      choicesLoaded = true;
    }
    return useMeetingChoices.getState();
  }

  function setChoices(next: MeetingChoices): void {
    useMeetingChoices.setState(next, true);
    deps.store().set(CHOICES_KEY, JSON.stringify(next));
  }

  /** "Will be late" that did not get through, per meeting: how often, and not before when. */
  const lateFailures = new Map<string, { tries: number; next: number }>();

  const modeOf = (circleId: string): TravelMode | undefined => choices()[circleId]?.mode;
  const remindsFor = (circleId: string) => choices()[circleId]?.remind !== false;

  function meetings(): Meeting[] {
    const docs = deps.docs();
    const places = deps.places();
    return (
      deps
        .circles()
        // Every circle's meeting (docs/ADR/0026), an event's as before.
        .filter((circle) => circle.myStatus === 'active')
        .flatMap((circle) => meetingOf(circle.id, docs, places) ?? [])
    );
  }

  /** How this phone got closer to the meeting place lately (for this time and place only). */
  function trackOf(meeting: Meeting): Progress[] {
    const held = read(deps.store(), TRACKS_KEY, tracksSchema, {})[meeting.circleId];
    return held?.meetAt === meeting.meetAt && held.placeId === meeting.place.id ? held.track : [];
  }

  /** Records where this phone stands, from shortly before the estimates start until they stop. */
  function record(current: readonly Meeting[], fix: Fix, at: number): void {
    const next: z.infer<typeof tracksSchema> = {};
    for (const meeting of current) {
      const { circleId, meetAt, place } = meeting;
      const from = meetAt - MEETING.etaFromMs - PROGRESS.windowMs;
      if (at < from || at > meetAt + MEETING.etaUntilMs) continue;
      const sample = { ts: at, remaining: distanceTo(fix, place) };
      next[circleId] = { meetAt, placeId: place.id, track: withProgress(trackOf(meeting), sample) };
    }
    deps.store().set(TRACKS_KEY, JSON.stringify(next));
  }

  /** When this phone will be at the meeting: its own progress, else a typical speed. */
  function arrivalFor(meeting: Meeting, fix: Fix, at: number): number {
    return estimateArrival({
      now: at,
      remaining: distanceTo(fix, meeting.place),
      activity: activityOf(fix.spd, 0),
      mode: modeOf(meeting.circleId),
      rate: approachRate(trackOf(meeting)),
    });
  }

  /** When this phone will be at the event's meeting, while that is worth telling. */
  function eta(circleId: string, fix: Fix, at: number): LocPayload['eta'] {
    const meeting = meetingOf(circleId, deps.docs(), deps.places());
    if (meeting === null || !inEtaWindow(meeting.meetAt, at)) return undefined;
    return { meetAt: meeting.meetAt, at: arrivalFor(meeting, fix, at) };
  }

  /**
   * "Will be late" to the others, by itself: once the estimate has said so for a few minutes, and
   * again only when it grows. Only while this phone shares its exact location with the event.
   */
  async function tellIfLate(meeting: Meeting, fix: Fix, at: number): Promise<void> {
    if (!inEtaWindow(meeting.meetAt, at) || !announcesTo(deps.sharing(), meeting.circleId, at)) {
      return;
    }
    const minutes = lateMinutes(arrivalFor(meeting, fix, at), meeting.meetAt);
    const key = `${meeting.circleId}:${String(meeting.meetAt)}`;
    const since = read(deps.store(), LATE_SINCE_KEY, toldSchema, {});
    const lateSince = since[key];
    if (minutes === 0 || lateSince === undefined) {
      const rest = Object.entries(since).filter(([held]) => held !== key);
      deps
        .store()
        .set(
          LATE_SINCE_KEY,
          JSON.stringify(Object.fromEntries(minutes === 0 ? rest : [...rest, [key, at]])),
        );
      return;
    }
    if (at - lateSince < MEETING.lateHoldMs) return;
    const told = read(deps.store(), TOLD_KEY, toldSchema, {});
    if (!lateIsNews(minutes, told[key])) return;
    const failed = lateFailures.get(key);
    if (failed !== undefined && at < failed.next) return;
    const circle = deps.circles().find((candidate) => candidate.id === meeting.circleId);
    // Paused: the server would refuse it; no try, no retries (QA 21 B-4).
    if (circle === undefined || circle.paused === true) return;
    try {
      await deps.sendLate(circle, meeting.meetAt, minutes);
    } catch (error) {
      const tries = (failed?.tries ?? 0) + 1;
      const wait = Math.min(MEETING.lateRetryMs * 2 ** (tries - 1), MEETING.lateRetryMaxMs);
      lateFailures.set(key, { tries, next: at + wait });
      throw error;
    }
    lateFailures.delete(key);
    deps.store().set(TOLD_KEY, JSON.stringify({ ...told, [key]: minutes }));
  }

  async function updateReminder(
    meeting: Meeting,
    fix: Fix,
    at: number,
  ): Promise<Reminders[string]> {
    const { circleId, meetAt, place } = meeting;
    const reminders = read(deps.store(), REMINDERS_KEY, remindersSchema, {});
    const held = reminders[circleId];
    const same = held?.meetAt === meetAt && held.placeId === place.id;
    if (same && held.done) return held;
    const next = leaveReminderAt(fix, place, meetAt, modeOf(circleId));
    const distance = distanceTo(fix, place);
    if (!remindsFor(circleId) || next === null || at >= next.leaveAt) {
      if (held !== undefined && !held.done) await deps.cancel(circleId);
      return { meetAt, placeId: place.id, remindAt: at, distance, done: true };
    }
    if (same) {
      // Shown already by the system, or clearly on the way: nothing more to remind.
      if (held.remindAt <= at || distance < held.distance - MEETING.nearM) {
        if (held.remindAt > at) await deps.cancel(circleId);
        return { ...held, done: true };
      }
      if (Math.abs(held.remindAt - next.remindAt) < 2 * 60_000) return held;
    }
    if (next.remindAt <= at) {
      const minutes = Math.max(1, Math.ceil((next.leaveAt - at) / 60_000));
      await deps.remind(circleId, null, deps.words(meeting, minutes));
      return { meetAt, placeId: place.id, remindAt: at, distance, done: true };
    }
    await deps.remind(circleId, next.remindAt, deps.words(meeting, MEETING.leaveNoticeMs / 60_000));
    return { meetAt, placeId: place.id, remindAt: next.remindAt, distance, done: false };
  }

  /** Reminders of events that no longer have a meeting go. */
  async function dropGone(current: readonly Meeting[]): Promise<void> {
    const reminders = read(deps.store(), REMINDERS_KEY, remindersSchema, {});
    const live = new Set(current.map((meeting) => meeting.circleId));
    const gone = Object.entries(reminders).filter(([circleId]) => !live.has(circleId));
    if (gone.length === 0) return;
    for (const [circleId, reminder] of gone) {
      if (!reminder.done) await deps.cancel(circleId);
    }
    const kept = Object.entries(reminders).filter(([circleId]) => live.has(circleId));
    deps.store().set(REMINDERS_KEY, JSON.stringify(Object.fromEntries(kept)));
  }

  return {
    eta,

    /** A new position of this phone: progress to keep, lateness to tell, reminders to set. */
    async fix(fix: Fix): Promise<void> {
      const at = now();
      const current = meetings();
      // Before anything waits: the location sent with this fix uses the progress just kept.
      record(current, fix, at);
      await dropGone(current);
      for (const meeting of current) {
        await tellIfLate(meeting, fix, at).catch(() => undefined);
        const reminder = await updateReminder(meeting, fix, at);
        const reminders = read(deps.store(), REMINDERS_KEY, remindersSchema, {});
        deps
          .store()
          .set(REMINDERS_KEY, JSON.stringify({ ...reminders, [meeting.circleId]: reminder }));
      }
    },

    /** "Geç kalacağım": told by the user, whatever the estimate says. */
    async late(circleId: string, minutes: number): Promise<boolean> {
      const meeting = meetingOf(circleId, deps.docs(), deps.places());
      const circle = deps.circles().find((candidate) => candidate.id === circleId);
      const plan = deps.docs()[docKey(circleId, circleId)]?.payload;
      const meetAt = meeting?.meetAt ?? (plan?.kind === 'plan' ? plan.meetAt : undefined);
      if (circle === undefined || circle.paused === true || meetAt === undefined) return false;
      try {
        await deps.sendLate(circle, meetAt, minutes);
      } catch {
        return false;
      }
      const told = read(deps.store(), TOLD_KEY, toldSchema, {});
      const key = `${circleId}:${String(meetAt)}`;
      deps
        .store()
        .set(TOLD_KEY, JSON.stringify({ ...told, [key]: Math.max(told[key] ?? 0, minutes) }));
      return true;
    },

    choices,

    /** How this phone gets to the event (undefined: worked out from distance and movement). */
    setMode(circleId: string, mode: TravelMode | undefined): void {
      const current = choices();
      const held = current[circleId] ?? {};
      const kept = held.remind === undefined ? {} : { remind: held.remind };
      setChoices({ ...current, [circleId]: mode === undefined ? kept : { ...kept, mode } });
    },

    /** Whether to remind this phone to leave for the event's meeting. */
    setRemind(circleId: string, remind: boolean): void {
      const current = choices();
      setChoices({ ...current, [circleId]: { ...current[circleId], remind } });
    },

    /**
     * Events this phone is no longer in (left, removed, over): their reminders are taken back and
     * everything kept about them goes (QA Faz 8 O5; docs/ADR/0017: nothing of an event stays).
     */
    async forget(isGone: (circleId: string) => boolean): Promise<void> {
      const store = deps.store();
      const reminders = read(store, REMINDERS_KEY, remindersSchema, {});
      for (const [circleId, reminder] of Object.entries(reminders)) {
        if (isGone(circleId) && !reminder.done) await deps.cancel(circleId).catch(() => undefined);
      }
      // Keys are `circleId` or `circleId:meetAt`.
      const keep = (key: string, schema: z.ZodType<Record<string, unknown>>) => {
        const all = read(store, key, schema, {});
        const kept = Object.entries(all).filter(([id]) => !isGone(id.split(':')[0] ?? ''));
        if (kept.length !== Object.keys(all).length) {
          store.set(key, JSON.stringify(Object.fromEntries(kept)));
        }
      };
      keep(REMINDERS_KEY, remindersSchema);
      keep(TRACKS_KEY, tracksSchema);
      keep(TOLD_KEY, toldSchema);
      keep(LATE_SINCE_KEY, toldSchema);
      const chosen = choices();
      const keptChoices = Object.entries(chosen).filter(([circleId]) => !isGone(circleId));
      if (keptChoices.length !== Object.keys(chosen).length) {
        setChoices(Object.fromEntries(keptChoices));
      }
      const lates = useLates.getState();
      const keptLates = Object.entries(lates).filter(([key]) => !isGone(key.split(':')[0] ?? ''));
      if (keptLates.length !== Object.keys(lates).length) {
        useLates.setState(Object.fromEntries(keptLates), true);
      }
    },

    reset(): void {
      choicesLoaded = false;
      useMeetingChoices.setState({}, true);
      useLates.setState({}, true);
    },
  };
}
