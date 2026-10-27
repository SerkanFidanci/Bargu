import {
  CHAT_LIFETIME_MS,
  chatEnvelopeSchema,
  type ChatPayload,
  type ChatRecord,
  chatPhotoSchema,
  directEnvelopeSchema,
} from '@bargu/schemas';
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyValueStore } from '../storage/vault';

/**
 * Messages and moments on this phone (docs/ADR/0035 §7): every item of the last 24 hours, kept in
 * the encrypted vault only, and deleted here when its day is over, whether or not the server said
 * so. A conversation is a circle's (`c:<circleId>`) or one person's (`p:<userId>`).
 */

/** The encrypted vault's key. */
export const MESSAGES_KEY = 'messages:v1';
/** A phone keeps at most this many items of one conversation (the newest). */
const PER_CONVERSATION_MAX = 1000;

export type Conversation = `c:${string}` | `p:${string}`;
export const circleConversation = (circleId: string): Conversation => `c:${circleId}`;
export const personConversation = (userId: string): Conversation => `p:${userId}`;
export function conversationTarget(
  conversation: Conversation,
): { circleId: string } | { userId: string } {
  return conversation.startsWith('c:')
    ? { circleId: conversation.slice(2) }
    : { userId: conversation.slice(2) };
}
const conversationSchema = z.custom<Conversation>(
  (value) => typeof value === 'string' && /^[cp]:[0-9a-f-]{36}$/.test(value),
);

const itemSchema = z
  .object({
    id: z.uuid(),
    conversation: conversationSchema,
    /** Who sent it (this phone's own user for its own items). */
    from: z.uuid(),
    /** When it was sent (the sender's clock, checked within 24 hours and 5 minutes on arrival). */
    at: z.number(),
    kind: z.enum(['text', 'photo']),
    text: z.string().optional(),
    replyTo: z.uuid().optional(),
    photo: chatPhotoSchema.omit({ kind: true, id: true, ts: true }).optional(),
    /** This phone's own items while they go out, and when they could not. */
    state: z.enum(['sending', 'sent', 'failed']),
    /**
     * The envelope as it came, for "Bildir": a report hands over this item's own key and needs the
     * signed envelope with it (docs/ADR/0035 §9). Never for this phone's own items.
     */
    envelope: z.union([chatEnvelopeSchema, directEnvelopeSchema]).optional(),
    /** People who took a screenshot of this phone's photo (docs/ADR/0035 §12). */
    shotBy: z.array(z.uuid()).optional(),
  })
  .strict();
export type ChatItem = z.infer<typeof itemSchema>;

const savedSchema = z
  .object({
    items: z.array(itemSchema),
    /** Up to when each conversation was read (an item's `at`). */
    read: z.record(z.string(), z.number()),
    /** The server's time of the newest item fetched: the next fetch starts there. */
    cursor: z.number(),
    /** Ids already shown or dropped, with when: an item comes once (docs/ADR/0035 §2). */
    seen: z.record(z.string(), z.number()),
  })
  .strict();
type Saved = z.infer<typeof savedSchema>;

export interface MessagesState extends Saved {
  /**
   * Items whose sender key (or trusted sender) has not arrived yet, kept in memory to try again;
   * the cursor stays before them, so a restart fetches them again.
   */
  waitingRecords: ChatRecord[];
  /** Whether this phone's items were read from the vault yet. */
  loaded: boolean;
}

const EMPTY: Saved = { items: [], read: {}, cursor: 0, seen: {} };

export const EMPTY_MESSAGES: MessagesState = { ...EMPTY, waitingRecords: [], loaded: false };
export const useMessages = create<MessagesState>(() => EMPTY_MESSAGES);

/** What the vault holds, with everything past its 24 hours gone (also from the vault itself). */
export function loadMessages(store: KeyValueStore, now: number): Saved {
  const raw = store.get(MESSAGES_KEY);
  if (raw === undefined) return { ...EMPTY };
  let found: unknown;
  try {
    found = JSON.parse(raw);
  } catch {
    store.delete(MESSAGES_KEY);
    return { ...EMPTY };
  }
  const parsed = savedSchema.safeParse(found);
  if (!parsed.success) {
    store.delete(MESSAGES_KEY);
    return { ...EMPTY };
  }
  const kept = expired(parsed.data, now);
  if (kept !== parsed.data) saveMessages(store, kept);
  return kept;
}

export function saveMessages(store: KeyValueStore, saved: Saved): void {
  if (saved.items.length === 0 && Object.keys(saved.seen).length === 0) {
    store.delete(MESSAGES_KEY);
    return;
  }
  const { items, read, cursor, seen } = saved;
  store.set(MESSAGES_KEY, JSON.stringify({ items, read, cursor, seen }));
}

/** The same state without what is older than 24 hours (the same object when nothing went). */
export function expired<T extends Saved>(saved: T, now: number): T {
  const since = now - CHAT_LIFETIME_MS;
  const items = saved.items.filter((item) => item.at >= since);
  const seenEntries = Object.entries(saved.seen);
  const seen = Object.fromEntries(seenEntries.filter(([, at]) => at >= since - 60 * 60_000));
  if (items.length === saved.items.length && seenEntries.length === Object.keys(seen).length) {
    return saved;
  }
  return { ...saved, items, seen };
}

/** When the next item's day is over (to delete it then), or null with nothing kept. */
export function nextExpiry(saved: Pick<Saved, 'items'>): number | null {
  let earliest: number | null = null;
  for (const item of saved.items) {
    const end = item.at + CHAT_LIFETIME_MS;
    if (earliest === null || end < earliest) earliest = end;
  }
  return earliest;
}

/** An item that arrived (or this phone sent): added once, in time order, the oldest beyond the cap gone. */
export function withItem<T extends Saved>(saved: T, item: ChatItem): T {
  if (saved.items.some((kept) => kept.id === item.id)) return saved;
  const inConversation = saved.items.filter((kept) => kept.conversation === item.conversation);
  const others = saved.items.filter((kept) => kept.conversation !== item.conversation);
  const sorted = [...inConversation, item].sort((a, b) => a.at - b.at);
  const capped = sorted.slice(Math.max(0, sorted.length - PER_CONVERSATION_MAX));
  return {
    ...saved,
    items: [...others, ...capped],
    seen: { ...saved.seen, [item.id]: item.at },
  };
}

export function withoutItem<T extends Saved>(saved: T, id: string): T {
  if (!saved.items.some((item) => item.id === id)) return saved;
  return { ...saved, items: saved.items.filter((item) => item.id !== id) };
}

export function withState<T extends Saved>(saved: T, id: string, state: ChatItem['state']): T {
  return {
    ...saved,
    items: saved.items.map((item) => (item.id === id ? { ...item, state } : item)),
  };
}

/**
 * What an opened item does here (docs/ADR/0035 §5): a text or a photo is added; `del` takes back an
 * item only its own sender sent; `shot` marks this phone's photo as screenshot by the sender.
 */
export function applyPayload<T extends Saved>(
  saved: T,
  payload: ChatPayload,
  from: string,
  conversation: Conversation,
  envelope: ChatItem['envelope'],
): T {
  const seen = { ...saved.seen, [payload.id]: payload.ts };
  if (payload.kind === 'del') {
    const target = saved.items.find((item) => item.id === payload.target);
    const kept = target?.from === from ? withoutItem(saved, payload.target) : saved;
    return { ...kept, seen };
  }
  if (payload.kind === 'shot') {
    const items = saved.items.map((item) =>
      item.id === payload.target && item.kind === 'photo' && item.from !== from
        ? { ...item, shotBy: [...new Set([...(item.shotBy ?? []), from])] }
        : item,
    );
    return { ...saved, items, seen };
  }
  const item: ChatItem = {
    id: payload.id,
    conversation,
    from,
    at: payload.ts,
    kind: payload.kind,
    state: 'sent',
    ...(envelope === undefined ? {} : { envelope }),
    ...(payload.kind === 'text'
      ? {
          text: payload.text,
          ...(payload.replyTo === undefined ? {} : { replyTo: payload.replyTo }),
        }
      : {
          photo: {
            blobId: payload.blobId,
            key: payload.key,
            size: payload.size,
            hash: payload.hash,
            w: payload.w,
            h: payload.h,
            story: payload.story,
            ...(payload.caption === undefined ? {} : { caption: payload.caption }),
          },
        }),
  };
  return { ...withItem(saved, item), seen };
}

/** Everything of a person (docs/ADR/0035 §8, PROTOCOL §8): their conversation and their items. */
export function withoutPerson<T extends Saved>(saved: T, userId: string): T {
  const conversation = personConversation(userId);
  return {
    ...saved,
    items: saved.items.filter((item) => item.from !== userId && item.conversation !== conversation),
    read: Object.fromEntries(Object.entries(saved.read).filter(([key]) => key !== conversation)),
  };
}

/** Everything of a circle this phone is no longer in (it left, it ended). */
export function withoutCircle<T extends Saved>(saved: T, circleId: string): T {
  const conversation = circleConversation(circleId);
  return {
    ...saved,
    items: saved.items.filter((item) => item.conversation !== conversation),
    read: Object.fromEntries(Object.entries(saved.read).filter(([key]) => key !== conversation)),
  };
}

/** Items of others in a conversation after it was last read. */
export function unreadIn(saved: Saved, conversation: Conversation, me: string): number {
  const read = saved.read[conversation] ?? 0;
  return saved.items.filter(
    (item) => item.conversation === conversation && item.from !== me && item.at > read,
  ).length;
}

/** Every unread item of others, in all conversations (the dock's count). */
export function unreadTotal(saved: Saved, me: string): number {
  return saved.items.filter(
    (item) => item.from !== me && item.at > (saved.read[item.conversation] ?? 0),
  ).length;
}

/** Conversations with items, the newest first, each with its last item. */
export function conversations(
  saved: Pick<Saved, 'items'>,
): { conversation: Conversation; last: ChatItem }[] {
  const last = new Map<Conversation, ChatItem>();
  for (const item of saved.items) {
    const kept = last.get(item.conversation);
    if (kept === undefined || item.at >= kept.at) last.set(item.conversation, item);
  }
  return [...last.entries()]
    .map(([conversation, item]) => ({ conversation, last: item }))
    .sort((a, b) => b.last.at - a.last.at);
}
