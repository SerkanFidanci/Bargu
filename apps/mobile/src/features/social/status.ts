import { encryptMessage } from '@bargu/crypto';
import {
  type Circle,
  MAX_CIRCLES_PER_REQUEST,
  MAX_ENVELOPES_PER_PUBLISH,
  type MessageEnvelope,
  publishReplySchema,
  statusPayloadSchema,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import { api, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { keys, liveRequest } from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { type ReceivedStatus, receivedStatusSchema, type Status } from './status-model';

export { type ReceivedStatus, type Status, statusOf } from './status-model';

/** Others' statuses per circle, keyed `${circleId}:${userId}`; kept in the vault like locations. */
export const useStatuses = create<Record<string, ReceivedStatus>>(() => ({}));
/** This user's own current status (null: none). */
export const useMyStatus = create<{ status: Status | null }>(() => ({ status: null }));

const STATUSES_KEY = 'statuses:v1';
const MINE_KEY = 'status:mine:v1';
/** How long a status may last, as offered in the app (BARGU_PLAN §4.3: up to 24 hours). */
export const STATUS_DURATIONS_H = [1, 4, 24] as const;
export const STATUS_TEXT_MAX = 40;

function persist(next: Record<string, ReceivedStatus>): void {
  useStatuses.setState(next, true);
  if (isVaultOpen()) vault().set(STATUSES_KEY, JSON.stringify(Object.values(next)));
}

/** Restores statuses kept before a restart (the replay guard refuses envelopes already opened). */
export function restoreStatuses(): void {
  if (!isVaultOpen()) return;
  const now = Date.now();
  const raw = vault().get(STATUSES_KEY);
  const parsed = z.array(receivedStatusSchema).safeParse(raw === undefined ? [] : JSON.parse(raw));
  if (parsed.success) {
    useStatuses.setState(
      Object.fromEntries(
        parsed.data
          .filter((entry) => entry.status.expiresAt > now)
          .map((entry) => [`${entry.circleId}:${entry.userId}`, entry]),
      ),
      true,
    );
  }
  const mine = statusPayloadSchema.safeParse(JSON.parse(vault().get(MINE_KEY) ?? 'null'));
  useMyStatus.setState({
    status: mine.success && mine.data.expiresAt > now ? mine.data : null,
  });
}

export function receivedStatus(circleId: string, userId: string, status: Status): void {
  persist({ ...useStatuses.getState(), [`${circleId}:${userId}`]: { circleId, userId, status } });
}

export function statusGone(circleId: string, userId: string): void {
  const key = `${circleId}:${userId}`;
  const current = useStatuses.getState();
  if (!(key in current)) return;
  persist(Object.fromEntries(Object.entries(current).filter(([k]) => k !== key)));
}

/** A person this phone shares no circle with any more: their statuses, in every circle, go. */
export function forgetStatusesOf(userId: string): void {
  const current = useStatuses.getState();
  const kept = Object.fromEntries(
    Object.entries(current).filter(([, entry]) => entry.userId !== userId),
  );
  if (Object.keys(kept).length !== Object.keys(current).length) persist(kept);
}

function circlesWithOthers(): Circle[] {
  const me = useAuth.getState().userId;
  return (queryClient.getQueryData<Circle[]>(circlesKey) ?? []).filter(
    (circle) =>
      circle.myStatus === 'active' &&
      circle.members.some((member) => member.userId !== me && member.status === 'active'),
  );
}

async function publish(envelopes: MessageEnvelope[], ttlSeconds: number): Promise<void> {
  for (let start = 0; start < envelopes.length; start += MAX_ENVELOPES_PER_PUBLISH) {
    const body = {
      envelopes: envelopes.slice(start, start + MAX_ENVELOPES_PER_PUBLISH),
      ttlSeconds,
    };
    const viaSocket = liveRequest('status', body);
    const reply = viaSocket === null ? null : await viaSocket.catch(() => null);
    if (publishReplySchema.safeParse(reply).success) continue;
    await api.authed('/v1/statuses', { method: 'POST', body });
  }
}

/**
 * Sets this user's status for every circle they are in (encrypted per circle like a location;
 * the server keeps it until it ends). Throws when it could not be sent.
 */
export async function setStatus(input: {
  emoji: string | null;
  text: string | null;
  hours: number;
}): Promise<void> {
  const device = useAuth.getState().device;
  if (device === null) throw new Error('signed out');
  const now = Date.now();
  const status: Status = {
    kind: 'status',
    ...(input.emoji === null ? {} : { emoji: input.emoji }),
    ...(input.text === null ? {} : { text: input.text }),
    expiresAt: now + input.hours * 3_600_000,
    ts: now,
  };
  const parsed = statusPayloadSchema.parse(status);
  const store = keys();
  const envelopes = circlesWithOthers().map(
    (circle) =>
      encryptMessage({
        state: { senderKey: store.ownKey(circle), nextSeq: store.reserveSeq(circle) },
        sender: device,
        payload: parsed,
      }).envelope,
  );
  if (envelopes.length > 0) await publish(envelopes, input.hours * 3_600);
  useMyStatus.setState({ status: parsed });
  vault().set(MINE_KEY, JSON.stringify(parsed));
}

/** Clears this user's status everywhere. */
export async function clearStatus(): Promise<void> {
  const circleIds = circlesWithOthers().map((circle) => circle.id);
  for (let start = 0; start < circleIds.length; start += MAX_CIRCLES_PER_REQUEST) {
    const body = { circleIds: circleIds.slice(start, start + MAX_CIRCLES_PER_REQUEST) };
    const viaSocket = liveRequest('status.withdraw', body);
    const reply: unknown = viaSocket === null ? null : await viaSocket.catch(() => null);
    if (typeof reply === 'object' && reply !== null && 'ok' in reply) continue;
    await api.authed('/v1/statuses/withdraw', { method: 'POST', body });
  }
  useMyStatus.setState({ status: null });
  vault().delete(MINE_KEY);
}

/** Circles or members changed: only active members of active circles keep a status here. */
export function pruneStatuses(circles: readonly Circle[]): void {
  const current = useStatuses.getState();
  const kept = Object.fromEntries(
    Object.entries(current).filter(([, entry]) => {
      const circle = circles.find((candidate) => candidate.id === entry.circleId);
      return (
        circle?.myStatus === 'active' &&
        circle.members.some((m) => m.userId === entry.userId && m.status === 'active')
      );
    }),
  );
  if (Object.keys(kept).length !== Object.keys(current).length) persist(kept);
}

/** Sign-out. */
export function resetStatuses(): void {
  useStatuses.setState({}, true);
  useMyStatus.setState({ status: null });
}
