import { encryptMessage } from '@bargu/crypto';
import {
  bumpReplySchema,
  type Circle,
  type DevicePushes,
  type MessageEnvelope,
  type PokePayload,
  type PokeSaying,
  type PokeStyle,
} from '@bargu/schemas';
import { create } from 'zustand';

import { api, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { memberName } from '../circles/names';
import { keys, liveRequest } from '../live/live-session';
import { contactsOf } from '../notifications/push-contacts';
import { sealPushes } from '../places/presence';
import { queryClient } from '../query-client';

/** When each person last poked this phone (their avatar bounces once). */
export const usePokes = create<Record<string, number>>(() => ({}));

/** A poke older than this when it arrives (it waited for a key) is not shown any more. */
const POKE_FRESH_MS = 60_000;

export type PokeResult = 'sent' | 'limited' | 'failed';

/** A live frame stays well under the socket's 16 KB; a poke to a big circle goes over HTTP. */
const SOCKET_BODY_LIMIT = 12_000;

async function deliver(envelope: MessageEnvelope, pushes: DevicePushes): Promise<unknown> {
  const body = { envelope, pushes };
  const viaSocket =
    JSON.stringify(body).length < SOCKET_BODY_LIMIT ? liveRequest('bump', body) : null;
  if (viaSocket !== null) {
    try {
      const reply = bumpReplySchema.safeParse(await viaSocket);
      if (reply.success) return reply.data;
    } catch {
      // No answer in time: try HTTP.
    }
  }
  return api.authed('/v1/bumps', { method: 'POST', body });
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
    // Members whose app is closed get a notification sealed for their device (docs/ADR/0016).
    const recipients =
      contactsOf([circle], store, useAuth.getState().userId).recipients[circle.id] ?? [];
    const pushes = sealPushes(recipients, device, { kind: 'bump', circleId, ts: Date.now() });
    const reply = bumpReplySchema.safeParse(await deliver(envelope, pushes));
    if (!reply.success) return 'failed';
    if ('ok' in reply.data) return 'sent';
    return reply.data.refused === 'RATE_LIMITED' ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}

/**
 * Pokes one member of a circle with a feeling or a question (docs/ADR/0031): the message goes to
 * the circle (the others' phones drop it), the sealed notification only to that member's phone.
 */
export async function pokeWith(
  circleId: string,
  to: string,
  style: PokeStyle,
  say?: PokeSaying,
): Promise<PokeResult> {
  const device = useAuth.getState().device;
  const circle = queryClient
    .getQueryData<Circle[]>(circlesKey)
    ?.find((candidate) => candidate.id === circleId);
  if (device === null || circle?.myStatus !== 'active') return 'failed';
  if (!circle.members.some((member) => member.userId === to && member.status === 'active')) {
    return 'failed';
  }
  try {
    const store = keys();
    const ts = Date.now();
    const sayIt = say === undefined ? {} : { say };
    const { envelope } = encryptMessage({
      state: { senderKey: store.ownKey(circle), nextSeq: store.reserveSeq(circle) },
      sender: device,
      payload: { kind: 'poke', to, style, ...sayIt, ts },
    });
    const recipients = (
      contactsOf([circle], store, useAuth.getState().userId).recipients[circle.id] ?? []
    ).filter((recipient) => recipient.userId === to);
    const pushes = sealPushes(recipients, device, { kind: 'poke', circleId, style, ...sayIt, ts });
    const reply = bumpReplySchema.safeParse(await deliver(envelope, pushes));
    if (!reply.success) return 'failed';
    if ('ok' in reply.data) return 'sent';
    return reply.data.refused === 'RATE_LIMITED' ? 'limited' : 'failed';
  } catch {
    return 'failed';
  }
}

/** A poke on this phone's screen now (docs/ADR/0031); `key` tells one from the next. */
export interface ShownPoke {
  key: number;
  circleId: string;
  userId: string;
  name: string;
  style: PokeStyle;
  say?: PokeSaying | undefined;
}

/** The poke playing on screen, or none. */
export const usePokeShow = create<ShownPoke | null>(() => null);

/** The pokes shown lately, by sender and time: one that comes by the socket and by its notification plays once. */
const played: string[] = [];
const PLAYED_KEPT = 20;

/** Plays a poke on screen, once. */
export function showPoke(poke: Omit<ShownPoke, 'key'>, ts: number, now = Date.now()): void {
  const id = `${poke.userId}:${String(ts)}`;
  if (played.includes(id)) return;
  played.push(id);
  if (played.length > PLAYED_KEPT) played.shift();
  usePokeShow.setState({ ...poke, key: now }, true);
}

function memberOf(circleId: string, userId: string) {
  return queryClient
    .getQueryData<Circle[]>(circlesKey)
    ?.find((candidate) => candidate.id === circleId)
    ?.members.find((candidate) => candidate.userId === userId);
}

/**
 * A poke with a feeling or a question: what to show, when it is for this phone, fresh, and from a
 * member it knows (null: show nothing). Their avatar bounces too, as for a plain poke.
 */
export function receiveStyledPoke(
  circleId: string,
  userId: string,
  poke: PokePayload,
  me: string | null,
  now = Date.now(),
): Omit<ShownPoke, 'key'> | null {
  if (me === null || poke.to !== me) return null;
  const name = receivePoke(circleId, userId, poke.ts, now);
  if (name === null) return null;
  return { circleId, userId, name, style: poke.style, say: poke.say };
}

/** A tapped poke notification: it plays when the app opens, however long it waited. */
export function pokeFromTap(tap: {
  circleId: string;
  from: string;
  style: PokeStyle;
  say?: PokeSaying | undefined;
  ts: number;
}): void {
  const member = memberOf(tap.circleId, tap.from);
  if (member === undefined) return;
  showPoke(
    {
      circleId: tap.circleId,
      userId: tap.from,
      name: memberName(member),
      style: tap.style,
      say: tap.say,
    },
    tap.ts,
  );
}

/** A person this phone shares no circle with any more: when they last poked it is forgotten. */
export function forgetPokesOf(userId: string): void {
  const pokes = usePokes.getState();
  if (!(userId in pokes)) return;
  usePokes.setState(
    Object.fromEntries(Object.entries(pokes).filter(([id]) => id !== userId)),
    true,
  );
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
