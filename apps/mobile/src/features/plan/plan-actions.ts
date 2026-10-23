import { randomUuid, voteId } from '@bargu/crypto';
import type { Circle, PlanPayload, PollPayload, PushBody, VotePayload } from '@bargu/schemas';

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
import { meetingStartPushes } from './meeting';
import {
  answerCounts,
  answersOf,
  type Doc,
  MEETING_ANSWERS,
  type MeetingAnswer,
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
  return circle.kind !== 'event' && planOf(circle.id).by === me;
}

/**
 * Starts a meeting in a circle that is no event (docs/ADR/0026): any member, with its place and
 * time. The others' phones hear it live; those not connected get one notification.
 */
export async function startMeeting(
  circle: Pick<Circle, 'id'>,
  meeting: { placeId: string; meetAt: number; placeGoes?: boolean },
): Promise<boolean> {
  const { userId: me, device } = useAuth.getState();
  const place = usePlaces.getState()[meeting.placeId];
  if (me === null || device === null || place === undefined) return told('failed');
  const pushes = meetingStartPushes({
    circleId: circle.id,
    place,
    meetAt: meeting.meetAt,
    device,
    recipients: loadContacts(vault()).recipients[circle.id] ?? [],
    now: Date.now(),
  });
  const { placeGoes, ...where } = meeting;
  const plan: PlanPayload = {
    kind: 'plan',
    id: circle.id,
    ...where,
    ...(placeGoes === true ? { placeGoes } : {}),
    by: me,
    ts: 0,
  };
  return told(await docs.save(circle.id, plan, { pushes }), i18n.t('meeting.started'));
}

/**
 * A place added for a meeting goes with it (docs/ADR/0026 Ek 1); one the circle had stays.
 * Nothing when it is gone already or this phone cannot read it.
 */
export async function forgetMeetingPlace(placeId: string): Promise<void> {
  const place = usePlaces.getState()[placeId];
  if (place !== undefined) await places.remove(place);
}

/**
 * Ends a circle's meeting at once ("Bitir", its starter or an admin); everyone's goes too, and the
 * place added for it unless `keepPlace`. Kept: the plan says so first, so no other phone of the
 * starter takes it away afterwards.
 */
export async function endMeeting(circleId: string, keepPlace = false): Promise<boolean> {
  const plan = planOf(circleId);
  if (keepPlace && plan.placeGoes === true) {
    await docs.save(circleId, { ...plan, placeGoes: false });
  }
  const ended = await docs.remove(circleId, circleId);
  if (ended) {
    if (!keepPlace && plan.placeGoes === true && plan.placeId !== undefined) {
      await forgetMeetingPlace(plan.placeId);
    }
    toast.success(i18n.t('meeting.ended'));
  } else toast.error(i18n.t('plan.failed'));
  return ended;
}

/**
 * Sets the meeting's time or place; the others' phones hear `docs.changed`. Moved away from a
 * place added for it, that place goes. The new one stays, unless it is a `spot` just picked on the
 * map for this meeting (docs/ADR/0026 Ek 1), which goes with the meeting in turn.
 */
export async function setMeeting(
  circleId: string,
  change: Pick<PlanPayload, 'meetAt' | 'placeId'> & { spot?: boolean },
): Promise<boolean> {
  const before = planOf(circleId);
  const { spot, ...where } = change;
  const leftPlace =
    where.placeId !== undefined &&
    where.placeId !== before.placeId &&
    before.placeGoes !== undefined;
  const { placeGoes, ...rest } = before;
  const next: PlanPayload = {
    ...rest,
    ...where,
    ...(spot === true
      ? { placeGoes: true }
      : leftPlace || placeGoes === undefined
        ? {}
        : { placeGoes }),
  };
  const saved = told(
    await docs.save(circleId, next, movedNotices(before, next)),
    i18n.t('plan.saved'),
  );
  if (saved && leftPlace && placeGoes === true && before.placeId !== undefined) {
    await forgetMeetingPlace(before.placeId);
  }
  return saved;
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
function movedNotices(before: PlanPayload, next: PlanPayload) {
  const moved =
    (next.meetAt !== undefined && next.meetAt !== before.meetAt) ||
    (next.placeId !== undefined && next.placeId !== before.placeId);
  const place = next.placeId === undefined ? undefined : usePlaces.getState()[next.placeId];
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
  const starter = planOf(circleId).by;
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

/** "Keep the place" (the starter): the place added for the meeting stays when it ends, or not. */
export async function keepMeetingPlace(circleId: string, keep: boolean): Promise<boolean> {
  const plan = planOf(circleId);
  if (plan.placeGoes === undefined) return true;
  return told(await docs.save(circleId, { ...plan, placeGoes: !keep }));
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
