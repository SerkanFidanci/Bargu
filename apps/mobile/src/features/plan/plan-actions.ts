import { randomUuid, voteId } from '@bargu/crypto';
import type { Circle, PlanPayload, PollPayload, VotePayload } from '@bargu/schemas';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { useAuth } from '../auth/auth-store';
import { loadContacts } from '../notifications/push-contacts';
import { usePlaces } from '../places/places';
import { vault } from '../storage/vault';
import { docKey, type DocSaveResult, useDocs } from './docs';
import { docs } from './docs-session';
import { meetingStartPushes } from './meeting';
import { type Doc, tally, withChoice } from './plan-model';

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
  meeting: { placeId: string; meetAt: number },
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
  const plan: PlanPayload = { kind: 'plan', id: circle.id, ...meeting, by: me, ts: 0 };
  return told(await docs.save(circle.id, plan, { pushes }), i18n.t('meeting.started'));
}

/** Ends a circle's meeting at once ("Bitir", its starter or an admin); everyone's goes too. */
export async function endMeeting(circleId: string): Promise<boolean> {
  const ended = await docs.remove(circleId, circleId);
  if (ended) toast.success(i18n.t('meeting.ended'));
  else toast.error(i18n.t('plan.failed'));
  return ended;
}

/** Sets the meeting's time or place; the others' phones hear `docs.changed`. */
export async function setMeeting(
  circleId: string,
  change: Pick<PlanPayload, 'meetAt' | 'placeId'>,
): Promise<boolean> {
  return told(await docs.save(circleId, { ...planOf(circleId), ...change }), i18n.t('plan.saved'));
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
