import { randomUuid, voteId } from '@bargu/crypto';
import type {
  Circle,
  MeetingSpot,
  PlanPayload,
  PollPayload,
  PushBody,
  VotePayload,
} from '@bargu/schemas';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { loadContacts } from '../notifications/push-contacts';
import { usePlaces } from '../places/places';
import { places } from '../places/places-session';
import { sealPushes } from '../places/presence';
import { vault } from '../storage/vault';
import { docKey, type DocSaveResult, useDocs } from './docs';
import { docs } from './docs-session';
import { meetingPlace, meetingStartPushes, SPOT_EMOJI } from './meeting';
import {
  answerCounts,
  answersOf,
  type Doc,
  MEETING_ANSWERS,
  type MeetingAnswer,
  starterOf,
  tally,
  withChoice,
} from './plan-model';

/** Tells how a save went; true when it went through. */
function told(result: DocSaveResult, saved?: string): boolean {
  if (result === 'saved') {
    if (saved !== undefined) toast.success(saved);
    return true;
  }
  toast.error(i18n.t(`plan.${result}`));
  return false;
}

/** The event's meeting as held, or an empty one (nothing decided yet). */
function planOf(circleId: string): PlanPayload {
  const held = useDocs.getState()[docKey(circleId, circleId)]?.payload;
  return held?.kind === 'plan' ? held : { kind: 'plan', id: circleId, ts: 0 };
}

/** The votes held for an event (each filed under its voter, docs.ts). */
export function votesOf(all: Readonly<Record<string, Doc>>, circleId: string): Doc<VotePayload>[] {
  return Object.values(all).flatMap((doc) =>
    doc.circleId === circleId && doc.payload.kind === 'vote'
      ? [{ ...doc, payload: doc.payload }]
      : [],
  );
}

/**
 * Who runs a circle's meeting (sets its time and place, ends it): an event's admins
 * (docs/ADR/0020); outside an event also whoever started it (docs/ADR/0026). The server holds the
 * same rule.
 */
export function mayRunMeeting(circle: Pick<Circle, 'id' | 'kind' | 'myRole'>, me: string): boolean {
  // In a friendship the two are equal (docs/ADR/0026 §1).
  if (circle.myRole === 'owner' || circle.kind === 'pair') return true;
  const doc = useDocs.getState()[docKey(circle.id, circle.id)];
  return circle.kind !== 'event' && starterOf(doc) === me;
}

/**
 * Where a meeting is (docs/ADR/0026 Ek 1): one of the circle's saved places, or a spot picked on
 * the map, kept inside the meeting and never saved as a place.
 */
export type MeetingWhere = { placeId: string } | { spot: MeetingSpot };

/**
 * Starts a meeting in a circle that is no event (docs/ADR/0026): any member, with its place and
 * time. The others' phones hear it live; those not connected get one notification.
 */
export async function startMeeting(
  circle: Pick<Circle, 'id'>,
  meeting: MeetingWhere & { meetAt: number },
): Promise<boolean> {
  const { userId: me, device } = useAuth.getState();
  if (me === null || device === null) return told('failed');
  const plan: PlanPayload = { kind: 'plan', id: circle.id, ...meeting, by: me, ts: 0 };
  const place = meetingPlace(plan, usePlaces.getState());
  if (place === undefined) return told('failed');
  const pushes = meetingStartPushes({
    circleId: circle.id,
    place,
    meetAt: meeting.meetAt,
    device,
    recipients: loadContacts(vault()).recipients[circle.id] ?? [],
    now: Date.now(),
  });
  return told(await docs.save(circle.id, plan, { pushes }), i18n.t('meeting.started'));
}

/**
 * Ends a circle's meeting at once ("Bitir", its starter or an admin); everyone's goes, and a spot
 * picked for it with it: nothing else to clean up. `keepSpot`: the one who ends it keeps the
 * spot as a saved place of the circle first, by their own choice ("Bitir, yeri sakla"). Tried
 * again after the ending failed, the place it kept is not saved twice (QA-37).
 */
export async function endMeeting(circleId: string, keepSpot = false): Promise<boolean> {
  const plan = planOf(circleId);
  const spot = plan.spot;
  const keptAlready =
    spot !== undefined &&
    Object.values(usePlaces.getState()).some(
      (place) =>
        place.circleId === circleId &&
        place.name === spot.name &&
        place.lat === spot.lat &&
        place.lng === spot.lng,
    );
  if (keepSpot && spot !== undefined && !keptAlready) {
    const kept = await places.save(circleId, {
      id: randomUuid(),
      name: spot.name,
      emoji: SPOT_EMOJI,
      lat: spot.lat,
      lng: spot.lng,
      radius: spot.radius,
    });
    if (kept !== 'saved') {
      toast.error(i18n.t('places.failed'));
      return false;
    }
  }
  const ended = await docs.remove(circleId, circleId);
  if (ended) toast.success(i18n.t('meeting.ended'));
  else toast.error(i18n.t('plan.failed'));
  return ended;
}

/**
 * Sets the meeting's time or place; the others' phones hear `docs.changed`. A new place is a
 * saved one or a spot, never both; no place is ever saved or deleted by it.
 */
export async function setMeeting(
  circleId: string,
  change: { meetAt?: number } & Partial<MeetingWhere>,
): Promise<boolean> {
  const before = planOf(circleId);
  const { placeId, spot, ...rest } = before;
  const where =
    'spot' in change
      ? { spot: change.spot }
      : 'placeId' in change
        ? { placeId: change.placeId }
        : {
            ...(placeId === undefined ? {} : { placeId }),
            ...(spot === undefined ? {} : { spot }),
          };
  const next: PlanPayload = {
    ...rest,
    ...where,
    ...(change.meetAt === undefined ? {} : { meetAt: change.meetAt }),
  };
  return told(await docs.save(circleId, next, movedNotices(before, next)), i18n.t('plan.saved'));
}

/** This phone's sealed notices for the given members' devices in a circle (none: undefined). */
function pushesTo(circleId: string, to: ReadonlySet<string>, body: PushBody) {
  const device = useAuth.getState().device;
  if (device === null || to.size === 0) return undefined;
  const recipients = (loadContacts(vault()).recipients[circleId] ?? []).filter((recipient) =>
    to.has(recipient.userId),
  );
  return recipients.length === 0 ? undefined : sealPushes(recipients, device, body);
}

/**
 * A meeting whose time or place changed: "moved to 18:30, still coming?" to those who said
 * Geliyorum or Belki (docs/ADR/0026 Ek 2), never to this user.
 */
function sameSpot(a: MeetingSpot, b: MeetingSpot | undefined): boolean {
  return a.lat === b?.lat && a.lng === b.lng && a.name === b.name;
}

function movedNotices(before: PlanPayload, next: PlanPayload) {
  const moved =
    (next.meetAt !== undefined && next.meetAt !== before.meetAt) ||
    (next.placeId !== undefined && next.placeId !== before.placeId) ||
    (next.spot !== undefined && !sameSpot(next.spot, before.spot));
  const place = meetingPlace(next, usePlaces.getState());
  const me = useAuth.getState().userId;
  if (!moved || next.meetAt === undefined || place === undefined) return {};
  const coming = new Set(
    [...answersOf(useDocs.getState(), next.id)]
      .filter(([userId, answer]) => userId !== me && answer !== 'not')
      .map(([userId]) => userId),
  );
  const pushes = pushesTo(next.id, coming, {
    kind: 'meetingMoved',
    circleId: next.id,
    name: place.name,
    emoji: place.emoji,
    meetAt: next.meetAt,
    ts: Date.now(),
  });
  return pushes === undefined ? {} : { pushes, moved: true };
}

/**
 * "Geliyorum / Belki / Gelemiyorum" to a circle's meeting (docs/ADR/0026 Ek 2): a vote whose poll
 * is the meeting, changed in place. Its starter hears who said what and how many come, unless the
 * starter is this user.
 */
export async function answerMeeting(circleId: string, answer: MeetingAnswer): Promise<boolean> {
  const me = useAuth.getState().userId;
  if (me === null) return told('failed');
  const starter = starterOf(useDocs.getState()[docKey(circleId, circleId)]);
  const choice = MEETING_ANSWERS.indexOf(answer);
  const { going, maybe } = answerCounts(
    new Map(answersOf(useDocs.getState(), circleId)).set(me, answer),
  );
  const pushes =
    starter === undefined || starter === me
      ? undefined
      : pushesTo(circleId, new Set([starter]), {
          kind: 'meetingAnswer',
          circleId,
          answer: choice,
          going,
          maybe,
          ts: Date.now(),
        });
  return told(
    await docs.save(
      circleId,
      { kind: 'vote', id: voteId(circleId, me), pollId: circleId, choices: [choice], ts: 0 },
      pushes === undefined ? {} : { pushes },
    ),
  );
}

export async function startPoll(
  circleId: string,
  by: string,
  about: PollPayload['about'],
  options: PollPayload['options'],
): Promise<boolean> {
  return told(
    await docs.save(circleId, { kind: 'poll', id: randomUuid(), by, about, options, ts: 0 }),
  );
}

/** This member's vote in a poll: the options they are fine with (none: no vote). */
export async function vote(
  circleId: string,
  pollId: string,
  userId: string,
  choices: number[],
): Promise<boolean> {
  return told(
    await docs.save(circleId, {
      kind: 'vote',
      id: voteId(pollId, userId),
      pollId,
      choices,
      ts: 0,
    }),
  );
}

/** Ends a poll with its leading option, which becomes the meeting's time or place. */
export async function closePoll(
  circleId: string,
  poll: PollPayload,
  members: ReadonlySet<string>,
): Promise<boolean> {
  const { leader } = tally(poll, votesOf(useDocs.getState(), circleId), members);
  if (leader === null) return false;
  if (!told(await docs.save(circleId, { ...poll, closed: { choice: leader } }))) return false;
  const { meetAt, placeId } = withChoice(planOf(circleId), poll, leader);
  return setMeeting(circleId, {
    ...(meetAt === undefined ? {} : { meetAt }),
    ...(placeId === undefined ? {} : { placeId }),
  });
}

export async function removePoll(circleId: string, pollId: string): Promise<boolean> {
  const removed = await docs.remove(circleId, pollId);
  if (!removed) toast.error(i18n.t('plan.failed'));
  return removed;
}
