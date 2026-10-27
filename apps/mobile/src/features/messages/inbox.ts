import { decryptChat, type DeviceKeys, type DevicePublicKeys, openDirect } from '@bargu/crypto';
import type { ChatEnvelope, ChatPayload, ChatRecord, Circle } from '@bargu/schemas';

import { verifiedBundle } from '../keys/bundle-cache';
import type { KeyStore } from '../keys/key-store';
import {
  applyPayload,
  circleConversation,
  type Conversation,
  type MessagesState,
  personConversation,
} from './messages';

/** What this phone knows to open an item with. */
export interface InboxContext {
  circles: readonly Circle[];
  keys: Pick<KeyStore, 'chatKey' | 'trusted' | 'ownPublicKeys'>;
  me: string;
  device: DeviceKeys;
  /** People this user blocked: what they send is never shown (docs/ADR/0035 §6). */
  blocked: ReadonlySet<string>;
  now: number;
}

export type Opened =
  | {
      payload: ChatPayload;
      conversation: Conversation;
      envelope: ChatRecord['envelope'] | undefined;
    }
  /** The sender key has not arrived yet, or the sender is not trusted yet: try again later. */
  | 'wait'
  /** Not to be shown, ever: forged, too old, someone blocked, or this phone's own sealed item. */
  | 'drop';

/**
 * A member's verified device keys: someone this phone shares a circle with whose identity key it
 * knows and trusts (a changed key holds everything until the user accepts it, as for locations).
 */
function senderOf(
  context: InboxContext,
  userId: string,
  deviceId: string,
): DevicePublicKeys | null {
  for (const circle of context.circles) {
    for (const member of circle.members) {
      if (member.userId !== userId || member.device?.bundle.deviceId !== deviceId) continue;
      if (!context.keys.trusted(member)) return null;
      try {
        return verifiedBundle(member.device.bundle);
      } catch {
        return null;
      }
    }
  }
  return null;
}

const isCircleItem = (envelope: ChatRecord['envelope']): envelope is ChatEnvelope =>
  'circleId' in envelope;

/** Opens one item from the server (live or listed), checked as docs/ADR/0035 §2 and §3 say. */
export function openRecord(record: ChatRecord, context: InboxContext): Opened {
  if (context.blocked.has(record.senderId)) return 'drop';
  const { envelope } = record;
  const mine = record.senderId === context.me;
  if (record.circleId !== null && isCircleItem(envelope)) {
    if (envelope.circleId !== record.circleId) return 'drop';
    const sender = mine
      ? context.keys.ownPublicKeys()
      : senderOf(context, record.senderId, envelope.senderDeviceId);
    const chatKey = context.keys.chatKey(record.circleId, envelope.epoch, envelope.senderDeviceId);
    if (sender === null || chatKey === null) return mine ? 'drop' : 'wait';
    try {
      const payload = decryptChat({ envelope, chatKey, sender, now: context.now });
      return {
        payload,
        conversation: circleConversation(record.circleId),
        envelope: mine ? undefined : envelope,
      };
    } catch {
      return 'drop';
    }
  }
  // An item for one person: only that person's device opens it; the sender keeps its own copy.
  if (mine || record.recipientId !== context.me || isCircleItem(envelope)) return 'drop';
  const sender = senderOf(context, record.senderId, envelope.senderDeviceId);
  if (sender === null) return 'wait';
  try {
    const payload = openDirect({ envelope, recipient: context.device, sender, now: context.now });
    return { payload, conversation: personConversation(record.senderId), envelope };
  } catch {
    return 'drop';
  }
}

/**
 * Items from the server into this phone's state: each id once (seen), the ones waiting for a key
 * kept to try again, and the cursor moved so a later fetch starts after what was taken but never
 * past what still waits.
 */
export function ingest(
  state: MessagesState,
  records: readonly ChatRecord[],
  context: InboxContext,
): MessagesState {
  let next = state;
  const waiting = new Map(state.waitingRecords.map((record) => [record.id, record]));
  let newest = state.cursor;
  for (const record of records) {
    newest = Math.max(newest, record.at);
    if (next.seen[record.id] !== undefined) continue;
    const opened = openRecord(record, context);
    if (opened === 'wait') {
      waiting.set(record.id, record);
      continue;
    }
    waiting.delete(record.id);
    if (opened === 'drop') {
      next = { ...next, seen: { ...next.seen, [record.id]: record.at } };
      continue;
    }
    next = applyPayload(
      next,
      opened.payload,
      record.senderId,
      opened.conversation,
      opened.envelope,
    );
  }
  const waitingRecords = [...waiting.values()];
  const earliestWaiting = Math.min(...waitingRecords.map((record) => record.at - 1));
  return {
    ...next,
    waitingRecords,
    cursor: Math.min(newest, earliestWaiting),
  };
}
