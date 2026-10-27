import { type DevicePublicKeys, encryptChat, randomUuid, sealDirect } from '@bargu/crypto';
import type { ChatPayload, ChatSendReply, Circle } from '@bargu/schemas';

import { useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { verifiedBundle } from '../keys/bundle-cache';
import { keys } from '../live/live-session';
import { contactsOf } from '../notifications/push-contacts';
import { sealPushes } from '../places/presence';
import { queryClient } from '../query-client';
import {
  type ChatItem,
  type Conversation,
  conversationTarget,
  useMessages,
  withItem,
  withoutItem,
  withState,
} from './messages';
import { messagesApi } from './messages-api';

export type SendResult = 'sent' | 'limited' | 'failed';

const cachedCircles = () => queryClient.getQueryData<Circle[]>(circlesKey) ?? [];

/** The current device of someone this phone shares a circle with, if it trusts their key. */
function deviceOf(
  circles: readonly Circle[],
  userId: string,
): { keys: DevicePublicKeys; dhKey: string } | null {
  const store = keys();
  for (const circle of circles) {
    if (circle.myStatus !== 'active') continue;
    for (const member of circle.members) {
      if (member.userId !== userId || member.status !== 'active' || member.device === null) {
        continue;
      }
      if (!store.trusted(member)) return null;
      try {
        return { keys: verifiedBundle(member.device.bundle), dhKey: member.device.bundle.dhKey };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * Seals and sends one payload to a conversation (docs/ADR/0035 §2, §3): for a circle with this
 * device's sender key of its current epoch, for a person sealed to their current device; with a
 * notification sealed for each device whose app may be closed (never what it says).
 */
async function deliver(conversation: Conversation, payload: ChatPayload): Promise<SendResult> {
  const { device, userId } = useAuth.getState();
  if (device === null || userId === null) return 'failed';
  const circles = cachedCircles();
  const target = conversationTarget(conversation);
  const photo = payload.kind === 'photo';
  let reply: ChatSendReply;
  try {
    if ('circleId' in target) {
      const circle = circles.find((candidate) => candidate.id === target.circleId);
      if (circle?.myStatus !== 'active') return 'failed';
      const store = keys();
      const envelope = encryptChat({ senderKey: store.ownKey(circle), sender: device, payload });
      const recipients = contactsOf([circle], store, userId).recipients[circle.id] ?? [];
      const pushes = sealPushes(recipients, device, {
        kind: 'chat',
        circleId: circle.id,
        photo,
        ts: payload.ts,
      });
      const blobId = payload.kind === 'photo' ? payload.blobId : undefined;
      reply = await messagesApi.toCircle(circle.id, envelope, pushes, blobId);
    } else {
      const recipient = deviceOf(circles, target.userId);
      if (recipient === null) return 'failed';
      const envelope = sealDirect({ sender: device, recipient: recipient.keys, payload });
      const pushes = sealPushes(
        [{ userId: target.userId, deviceId: recipient.keys.deviceId, dhKey: recipient.dhKey }],
        device,
        { kind: 'chat', photo, ts: payload.ts },
      );
      const blobId = payload.kind === 'photo' ? payload.blobId : undefined;
      reply = await messagesApi.toPerson(target.userId, envelope, pushes, blobId);
    }
  } catch {
    return 'failed';
  }
  if ('ok' in reply) return 'sent';
  return reply.refused === 'RATE_LIMITED' || reply.refused === 'DAILY_LIMIT' ? 'limited' : 'failed';
}

/** The payload of one of this phone's own items, to send it again as it was (same id, same time). */
function payloadOf(item: ChatItem): ChatPayload | null {
  if (item.kind === 'text' && item.text !== undefined) {
    return {
      kind: 'text',
      id: item.id,
      text: item.text,
      ts: item.at,
      ...(item.replyTo === undefined ? {} : { replyTo: item.replyTo }),
    };
  }
  if (item.kind === 'photo' && item.photo !== undefined) {
    return { kind: 'photo', id: item.id, ...item.photo, ts: item.at };
  }
  return null;
}

/** Sends one of this phone's own items, shown at once and marked sent or failed when it is known. */
async function sendItem(item: ChatItem): Promise<SendResult> {
  const payload = payloadOf(item);
  if (payload === null) return 'failed';
  useMessages.setState((state) =>
    state.items.some((kept) => kept.id === item.id)
      ? withState(state, item.id, 'sending')
      : withItem(state, { ...item, state: 'sending' }),
  );
  const result = await deliver(item.conversation, payload);
  useMessages.setState((state) => withState(state, item.id, result === 'sent' ? 'sent' : 'failed'));
  return result;
}

/** A text for a conversation (1–1000 characters, docs/ADR/0035 §5). */
export function sendText(
  conversation: Conversation,
  text: string,
  replyTo?: string,
): Promise<SendResult> {
  const me = useAuth.getState().userId;
  if (me === null) return Promise.resolve('failed');
  return sendItem({
    id: randomUuid(),
    conversation,
    from: me,
    at: Date.now(),
    kind: 'text',
    text,
    state: 'sending',
    ...(replyTo === undefined ? {} : { replyTo }),
  });
}

/** Tries a failed item again, as it was (the server keeps an id once). */
export function retry(itemId: string): Promise<SendResult> {
  const item = useMessages.getState().items.find((kept) => kept.id === itemId);
  return item === undefined ? Promise.resolve('failed') : sendItem(item);
}

/**
 * "Herkesten sil" (docs/ADR/0035 §5): a `del` item for those who already have it (also on phones
 * that were away), then the item goes from the server and from here.
 */
export async function takeBack(itemId: string): Promise<SendResult> {
  const item = useMessages.getState().items.find((kept) => kept.id === itemId);
  const me = useAuth.getState().userId;
  if (item?.from !== me) return 'failed';
  if (item.state === 'sent') {
    const told = await deliver(item.conversation, {
      kind: 'del',
      id: randomUuid(),
      target: item.id,
      ts: Date.now(),
    });
    if (told !== 'sent') return told;
    try {
      await messagesApi.remove(item.id);
    } catch {
      // Gone for everyone already by the `del` item; the server's copy goes with its 24 hours.
    }
  }
  useMessages.setState((state) => withoutItem(state, item.id));
  return 'sent';
}

/**
 * "Ekran görüntüsü aldı" (docs/ADR/0035 §12): this phone took a screenshot of someone's photo; the
 * sender is told with a `shot` item. Best effort: nothing is shown if it does not go.
 */
export async function tellScreenshot(item: ChatItem): Promise<void> {
  if (item.kind !== 'photo') return;
  await deliver(item.conversation, {
    kind: 'shot',
    id: randomUuid(),
    target: item.id,
    ts: Date.now(),
  });
}
