import { encryptChat, randomUuid } from '@bargu/crypto';
import {
  type ChatPayload,
  type Circle,
  ROLLCALL,
  type Rollcall,
  type RollcallRefusal,
  rollcallSchema,
} from '@bargu/schemas';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { verifiedBundle } from '../keys/bundle-cache';
import { keys, onLiveMessage } from '../live/live-session';
import { contactsOf } from '../notifications/push-contacts';
import { sealPushes } from '../places/presence';
import { queryClient } from '../query-client';
import { rollcallApi } from './rollcall-api';
import { type CheckedRollcall, checkRollcall, ownersOf, type RollcallKeys } from './rollcall-model';

/**
 * Event roll calls on this phone (docs/ADR/0040): the circle's open or latest roll call, checked
 * (rollcall-model.ts), kept in the query cache and updated from the server's `rollcall` message; no
 * polling. Asking, answering and ending seal small items with this device's chat key for the
 * circle; asking also seals each member's notification (never what it says).
 */
export const rollcallKey = (circleId: string) => ['rollcall', circleId] as const;

const cachedCircle = (circleId: string) =>
  queryClient.getQueryData<Circle[]>(circlesKey)?.find((circle) => circle.id === circleId);

/** The keys to open a circle's roll call with: its chat keys and its trusted members' devices. */
function keysOf(circle: Circle): RollcallKeys {
  const store = keys();
  const me = useAuth.getState().userId;
  return {
    chatKey: (circleId, epoch, deviceId) => store.chatKey(circleId, epoch, deviceId),
    sender: (userId, deviceId) => {
      if (userId === me) {
        const own = store.ownPublicKeys();
        return own.deviceId === deviceId ? own : null;
      }
      const member = circle.members.find((candidate) => candidate.userId === userId);
      if (member?.device?.bundle.deviceId !== deviceId || !store.trusted(member)) return null;
      try {
        return verifiedBundle(member.device.bundle);
      } catch {
        return null;
      }
    },
  };
}

function checked(rollcall: Rollcall, circle: Circle): CheckedRollcall | null {
  return checkRollcall(rollcall, ownersOf(circle), keysOf(circle), Date.now());
}

/** The circle's open or latest roll call this phone may see (null for none). */
export function useRollcall(circle: Circle) {
  return useQuery({
    queryKey: rollcallKey(circle.id),
    queryFn: async () => {
      const { rollcall } = await rollcallApi.current(circle.id);
      return rollcall === null ? null : checked(rollcall, circle);
    },
    enabled: circle.kind === 'event' && circle.myStatus === 'active',
  });
}

function seal(circle: Circle, payload: ChatPayload) {
  const { device } = useAuth.getState();
  if (device === null) throw new Error('signed out');
  return encryptChat({ senderKey: keys().ownKey(circle), sender: device, payload });
}

/** What a step came to: done, or the server's reason not to. */
export type RollcallResult = 'ok' | RollcallRefusal | 'failed';

function settle(
  reply: { ok: true; rollcall: Rollcall } | { refused: RollcallRefusal },
  circle: Circle,
) {
  if ('refused' in reply) return reply.refused;
  queryClient.setQueryData(rollcallKey(circle.id), checked(reply.rollcall, circle));
  return 'ok' as const;
}

/** "Herkes yerinde mi?": an owner asks, for ten minutes. */
export async function startRollcall(circle: Circle): Promise<RollcallResult> {
  const { device, userId } = useAuth.getState();
  if (device === null || userId === null) return 'failed';
  try {
    const now = Date.now();
    const envelope = seal(circle, {
      kind: 'rollcall',
      id: randomUuid(),
      closesAt: now + ROLLCALL.openMs,
      ts: now,
    });
    const recipients = contactsOf([circle], keys(), userId).recipients[circle.id] ?? [];
    const pushes = sealPushes(recipients, device, {
      kind: 'rollcall',
      circleId: circle.id,
      ts: now,
    });
    return settle(await rollcallApi.start(circle.id, envelope, pushes), circle);
  } catch {
    return 'failed';
  }
}

/** "Buradayım": no location goes with it. */
export async function answerRollcall(circle: Circle, rollcallId: string): Promise<RollcallResult> {
  try {
    const envelope = seal(circle, { kind: 'here', id: randomUuid(), rollcallId, ts: Date.now() });
    return settle(await rollcallApi.answer(circle.id, rollcallId, envelope), circle);
  } catch {
    return 'failed';
  }
}

/** "Bitir": an owner ends it now. */
export async function closeRollcall(circle: Circle, rollcallId: string): Promise<RollcallResult> {
  try {
    return settle(await rollcallApi.close(circle.id, rollcallId), circle);
  } catch {
    return 'failed';
  }
}

/**
 * "Buradayım" from the notification's button (the app may be closed): the circle's current roll
 * call is asked for, and answered if it is still open.
 */
export async function answerCurrent(circleId: string): Promise<RollcallResult> {
  const circle = cachedCircle(circleId);
  if (circle === undefined) return 'failed';
  try {
    const { rollcall } = await rollcallApi.current(circleId);
    if (rollcall === null) return 'CLOSED';
    return await answerRollcall(circle, rollcall.id);
  } catch {
    return 'failed';
  }
}

const liveSchema = z.object({ rollcall: rollcallSchema });

onLiveMessage((name, payload) => {
  if (name === 'rollcall') {
    const parsed = liveSchema.safeParse(payload);
    if (!parsed.success) return;
    const circle = cachedCircle(parsed.data.rollcall.circleId);
    if (circle === undefined) return;
    queryClient.setQueryData(rollcallKey(circle.id), checked(parsed.data.rollcall, circle));
  }
});
