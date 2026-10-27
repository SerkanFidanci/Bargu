import { type DevicePublicKeys, encryptChat, randomUuid, sealDirect } from '@bargu/crypto';
import type { ChatPayload, ChatSendReply, Circle, PushBody } from '@bargu/schemas';

import { ApiError } from '../auth/api-client';
import { useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { partnerOf } from '../circles/names';
import { verifiedBundle } from '../keys/bundle-cache';
import { keys } from '../live/live-session';
import { contactsOf } from '../notifications/push-contacts';
import { sealPushes } from '../places/presence';
import { queryClient } from '../query-client';
import {
  type ChatItem,
  circleConversation,
  type Conversation,
  conversationTarget,
  personConversation,
  useMessages,
  withItem,
  withoutItem,
  withState,
} from './messages';
import { messagesApi } from './messages-api';
import { type PhotoFile, uploadPhoto } from './photo';
import { forgetRules, whenRulesAccepted } from './rules-state';

/**
 * `full`: the server's space for photos is full (texts still go, docs/ADR/0035 §10). `rules`: the
 * server has no record of the community rules being accepted (K14); they are asked again.
 */
export type SendResult = 'sent' | 'limited' | 'full' | 'rules' | 'failed';

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
 * What a closed app is told of an item (docs/ADR/0035 §11), never what it says: a text or a photo,
 * a story, a screenshot of one's photo. Taking an item back tells nobody.
 */
export function pushOf(payload: ChatPayload, circleId: string | undefined): PushBody | null {
  switch (payload.kind) {
    case 'text':
    case 'photo':
      if (payload.kind === 'photo' && payload.story) {
        return { kind: 'moment', ...(circleId === undefined ? {} : { circleId }), ts: payload.ts };
      }
      return {
        kind: 'chat',
        ...(circleId === undefined ? {} : { circleId }),
        photo: payload.kind === 'photo',
        ts: payload.ts,
      };
    case 'shot':
      return { kind: 'shot', ts: payload.ts };
    case 'del':
      return null;
  }
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
  const blobId = payload.kind === 'photo' ? payload.blobId : undefined;
  let reply: ChatSendReply;
  try {
    if ('circleId' in target) {
      const circle = circles.find((candidate) => candidate.id === target.circleId);
      if (circle?.myStatus !== 'active') return 'failed';
      const store = keys();
      const envelope = encryptChat({ senderKey: store.ownKey(circle), sender: device, payload });
      const recipients = contactsOf([circle], store, userId).recipients[circle.id] ?? [];
      const push = pushOf(payload, circle.id);
      const pushes = push === null ? [] : sealPushes(recipients, device, push);
      reply = await messagesApi.toCircle(circle.id, envelope, pushes, blobId);
    } else {
      const recipient = deviceOf(circles, target.userId);
      if (recipient === null) return 'failed';
      const envelope = sealDirect({ sender: device, recipient: recipient.keys, payload });
      const push = pushOf(payload, undefined);
      const pushes =
        push === null
          ? []
          : sealPushes(
              [
                {
                  userId: target.userId,
                  deviceId: recipient.keys.deviceId,
                  dhKey: recipient.dhKey,
                },
              ],
              device,
              push,
            );
      reply = await messagesApi.toPerson(target.userId, envelope, pushes, blobId);
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'RULES_REQUIRED') {
      forgetRules();
      return 'rules';
    }
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
  const uploaded = payload.kind === 'photo' ? await upload(payload.blobId) : 'sent';
  const result = uploaded === 'sent' ? await deliver(item.conversation, payload) : uploaded;
  useMessages.setState((state) => withState(state, item.id, result === 'sent' ? 'sent' : 'failed'));
  return result;
}

/** The photo's file to the server first (once, however many items share it). */
async function upload(blobId: string): Promise<SendResult> {
  try {
    return (await uploadPhoto(blobId)) ? 'sent' : 'failed';
  } catch (error) {
    if (!(error instanceof ApiError)) return 'failed';
    if (error.code === 'RULES_REQUIRED') {
      forgetRules();
      return 'rules';
    }
    if (error.code === 'MEDIA_FULL') return 'full';
    return error.code === 'RATE_LIMITED' ? 'limited' : 'failed';
  }
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

/** A photo for one conversation (a circle's, or one person's): an item of it, not a story. */
export function sendPhoto(
  conversation: Conversation,
  file: PhotoFile,
  caption?: string,
): Promise<SendResult> {
  const me = useAuth.getState().userId;
  if (me === null) return Promise.resolve('failed');
  return sendItem({
    id: randomUuid(),
    conversation,
    from: me,
    at: Date.now(),
    kind: 'photo',
    photo: { ...file, story: false, ...(caption === undefined ? {} : { caption }) },
    state: 'sending',
  });
}

/** How a story went: all of it, or how many of its circles it did not reach. */
export interface StoryResult {
  result: SendResult;
  /** Circles (and friends) it did not reach: their conversation shows it, to try again. */
  failed: number;
  total: number;
}

/**
 * Where a story goes for each circle: a circle's own conversation, or for a friendship the friend
 * alone (a pair talks as the two people, docs/ADR/0035 §1; the server takes no circle item there).
 * Each place once, and each person once: a friend who is also in a chosen circle gets it there,
 * not a second time alone (one item, one notification; QA-38b).
 */
export function storyTargets(
  circleIds: readonly string[],
  circles: readonly Circle[],
  me: string,
): Conversation[] {
  const chosen = circleIds.flatMap((circleId) => {
    const circle = circles.find((candidate) => candidate.id === circleId);
    return circle === undefined ? [] : [circle];
  });
  const reached = new Set(
    chosen
      .filter((circle) => circle.kind !== 'pair')
      .flatMap((circle) =>
        circle.members
          .filter((member) => member.status === 'active')
          .map((member) => member.userId),
      ),
  );
  const targets = new Set<Conversation>();
  for (const circleId of circleIds) {
    const circle = chosen.find((candidate) => candidate.id === circleId);
    if (circle?.kind !== 'pair') {
      targets.add(circleConversation(circleId));
      continue;
    }
    const partner = partnerOf(circle, me);
    if (partner !== undefined && !reached.has(partner.userId)) {
      targets.add(personConversation(partner.userId));
    }
  }
  return [...targets];
}

/**
 * A story (docs/ADR/0035 §1, §4): one photo, uploaded once, with an item of its own for each
 * circle (sealed in each circle's envelope, or to the friend alone for a friendship), all marked as
 * a story. What did not go shows in its conversation, to be tried again.
 */
export async function shareStory(
  circleIds: readonly string[],
  file: PhotoFile,
  caption?: string,
): Promise<StoryResult> {
  const me = useAuth.getState().userId;
  const targets = me === null ? [] : storyTargets(circleIds, cachedCircles(), me);
  if (me === null || targets.length === 0) return { result: 'failed', failed: 0, total: 0 };
  const at = Date.now();
  const results = await Promise.all(
    targets.map((conversation) =>
      sendItem({
        id: randomUuid(),
        conversation,
        from: me,
        at,
        kind: 'photo',
        photo: { ...file, story: true, ...(caption === undefined ? {} : { caption }) },
        state: 'sending',
      }),
    ),
  );
  const missed = results.filter((result) => result !== 'sent');
  return {
    result: missed[0] ?? 'sent',
    failed: missed.length,
    total: results.length,
  };
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

/** "Herkesten sil" for a photo shared as a story: every circle's item of it. */
export async function takeBackPhoto(blobId: string): Promise<SendResult> {
  const me = useAuth.getState().userId;
  const mine = useMessages
    .getState()
    .items.filter((item) => item.from === me && item.photo?.blobId === blobId);
  const results = await Promise.all(mine.map((item) => takeBack(item.id)));
  return results.find((result) => result !== 'sent') ?? 'sent';
}

/**
 * "Ekran görüntüsü aldı" (docs/ADR/0035 §12): this phone took a screenshot of someone's photo; its
 * sender alone is told, with a `shot` item sealed to them (not to the whole circle). Nothing is
 * shown here. If the server has no record of this user's rules (they open before any photo, so
 * rarely), the notice is kept until they are accepted, then sent: it is never lost (QA-38b).
 */
export async function tellScreenshot(item: ChatItem): Promise<void> {
  if (item.kind !== 'photo' || item.from === useAuth.getState().userId) return;
  const told = await deliver(personConversation(item.from), {
    kind: 'shot',
    id: randomUuid(),
    target: item.id,
    ts: Date.now(),
  });
  if (told === 'rules' && !heldScreenshots.some((held) => held.id === item.id)) {
    heldScreenshots.push(item);
  }
}

/** Screenshot notices waiting for the rules to be accepted (this run of the app). */
const heldScreenshots: ChatItem[] = [];

/** The rules were accepted: what waited for them goes now. */
export async function sendHeldScreenshots(): Promise<void> {
  const held = heldScreenshots.splice(0);
  for (const item of held) await tellScreenshot(item);
}

whenRulesAccepted(() => {
  void sendHeldScreenshots();
});
