import { encryptMessage } from '@bargu/crypto';
import { bumpReplySchema, type Circle, type MessageEnvelope } from '@bargu/schemas';
import { create } from 'zustand';

import { api, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { memberName } from '../circles/names';
import { keys, liveRequest } from '../live/live-session';
import { queryClient } from '../query-client';

/** When each person last poked this phone (their avatar bounces once). */
export const usePokes = create<Record<string, number>>(() => ({}));

/** A poke older than this when it arrives (it waited for a key) is not shown any more. */
export const POKE_FRESH_MS = 60_000;

export type PokeResult = 'sent' | 'limited' | 'failed';

async function deliver(envelope: MessageEnvelope): Promise<unknown> {
  const viaSocket = liveRequest('bump', { envelope });
  if (viaSocket !== null) {
    try {
      const reply = bumpReplySchema.safeParse(await viaSocket);
      if (reply.success) return reply.data;
    } catch {
      // No answer in time: try HTTP.
    }
  }
  return api.authed('/v1/bumps', { method: 'POST', body: { envelope } });
}

/**
 * Pokes everyone else in a circle (BARGU_PLAN §4.3): an encrypted, signed `bump` message that the
 * server forwards without keeping. The server allows ten a minute per circle.
 */
export async function poke(circleId: string): Promise<PokeResult> {
  const device = useAuth.getState().device;
  const circle = queryClient
    .getQueryData<Circle[]>(circlesKey)
    ?.find((candidate) => candidate.id === circleId);
  if (device === null || circle?.myStatus !== 'active') return 'failed';
  try {
    const store = keys();
    const { envelope } = encryptMessage({
      state: { senderKey: store.ownKey(circle), nextSeq: store.reserveSeq(circle) },
      sender: device,
      payload: { kind: 'bump', ts: Date.now() },
    });
    const reply = bumpReplySchema.safeParse(await deliver(envelope));
    if (!reply.success) return 'failed';
    if ('ok' in reply.data) return 'sent';
    return reply.data.refused === 'RATE_LIMITED' ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}

/** Someone poked this phone: their name, when fresh (null: too old or unknown, show nothing). */
export function receivePoke(
  circleId: string,
  userId: string,
  ts: number,
  now = Date.now(),
): string | null {
  if (now - ts > POKE_FRESH_MS) return null;
  const circle = queryClient
    .getQueryData<Circle[]>(circlesKey)
    ?.find((candidate) => candidate.id === circleId);
  const member = circle?.members.find((candidate) => candidate.userId === userId);
  if (member === undefined) return null;
  usePokes.setState({ [userId]: now });
  return memberName(member);
}
