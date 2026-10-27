import {
  CHAT_LIFETIME_MS,
  chatEventSchema,
  chatGoneEventSchema,
  type ChatRecord,
  type Circle,
} from '@bargu/schemas';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { onSignedOut, useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import {
  keys,
  onCirclesGone,
  onLiveMessage,
  onOnline,
  onPeopleDeparted,
} from '../live/live-session';
import { queryClient } from '../query-client';
import { isVaultOpen, vault } from '../storage/vault';
import { ingest } from './inbox';
import {
  conversationTarget,
  EMPTY_MESSAGES,
  expired,
  loadMessages,
  type MessagesState,
  nextExpiry,
  saveMessages,
  useMessages,
  withoutCircle,
  withoutItem,
  withoutPerson,
  withViewed,
} from './messages';
import { loadBlocked, saveBlocked } from './blocked';
import { messagesApi } from './messages-api';
import { withoutLapsed } from './names';
import { forgetPhotoFiles, sweepPictureFiles } from './photo';

/**
 * Messages and moments on this phone (docs/ADR/0035): read from the vault once it is open, kept
 * there as they change, fed by the live `chat` messages and, after every (re)connection, by what
 * the server took meanwhile; everything older than 24 hours deleted on time; a person's and a
 * circle's items gone with them.
 */

/** The people this user blocked, as the server says (only theirs). */
export const useBlocked = create<{ blocked: readonly string[] }>(() => ({ blocked: [] }));

const cachedCircles = () => queryClient.getQueryData<Circle[]>(circlesKey) ?? [];

/** Reads this phone's items once the vault is open (no-op afterwards). */
export function loadMessagesOnce(): boolean {
  if (useMessages.getState().loaded) return true;
  if (!isVaultOpen()) return false;
  const store = vault();
  const saved = loadMessages(store, Date.now());
  useBlocked.setState({ blocked: loadBlocked(store) });
  useMessages.setState({ ...saved, waitingRecords: [], loaded: true });
  scheduleExpiry();
  return true;
}

/** Items from the server (live or listed) into this phone's state. */
export function receive(records: readonly ChatRecord[]): void {
  if (!loadMessagesOnce()) return;
  const { device, userId } = useAuth.getState();
  if (device === null || userId === null) return;
  const context = {
    circles: cachedCircles(),
    keys: keys(),
    me: userId,
    device,
    blocked: new Set(useBlocked.getState().blocked),
    now: Date.now(),
  };
  useMessages.setState((state) => ingest(state, records, context));
}

/** What the server took while this phone was away (or since the app opened), then what waited. */
export async function catchUp(): Promise<void> {
  if (!loadMessagesOnce()) return;
  const since = Math.max(useMessages.getState().cursor, Date.now() - CHAT_LIFETIME_MS);
  try {
    receive(await messagesApi.since(since));
  } catch {
    // Offline or refused: the next connection tries again.
  }
  receive(useMessages.getState().waitingRecords);
}

/** Who this user blocked, from the server (the list is theirs only). */
export async function refreshBlocked(): Promise<void> {
  try {
    const blocked = await messagesApi.blocked();
    useBlocked.setState({ blocked });
    if (isVaultOpen()) saveBlocked(vault(), blocked);
  } catch {
    // The list kept from before stays.
  }
}

/** Blocks someone: what they send is hidden from now on, and what they sent goes from here. */
export async function block(userId: string): Promise<void> {
  await messagesApi.block(userId);
  const blocked = [...new Set([...useBlocked.getState().blocked, userId])];
  useBlocked.setState({ blocked });
  if (isVaultOpen()) saveBlocked(vault(), blocked);
  useMessages.setState((state) => withoutPerson(state, userId));
}

export async function unblock(userId: string): Promise<void> {
  await messagesApi.unblock(userId);
  const blocked = useBlocked.getState().blocked.filter((id) => id !== userId);
  useBlocked.setState({ blocked });
  if (isVaultOpen()) saveBlocked(vault(), blocked);
}

/** Up to here a conversation was read (it shows no unread count until something newer). */
export function markRead(conversation: string, upTo: number): void {
  useMessages.setState((state) =>
    (state.read[conversation] ?? 0) >= upTo
      ? state
      : { ...state, read: { ...state.read, [conversation]: upTo } },
  );
}

/** A story was shown: its ring turns grey once all of that person's are (docs/ADR/0035 §8). */
export function markViewed(blobId: string): void {
  useMessages.setState((state) => withViewed(state, blobId, Date.now()));
}

// ---- the day of each item ------------------------------------------------------------------

let expiryTimer: ReturnType<typeof setTimeout> | null = null;

/** Deletes what is past its 24 hours now, and sets one timer for the next item's end. */
function scheduleExpiry(): void {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  const now = Date.now();
  useMessages.setState((state) => expired(state, now));
  const next = nextExpiry(useMessages.getState());
  if (next === null) return;
  // Timers longer than about 24 days overflow; an item lives a day at most anyway.
  expiryTimer = setTimeout(scheduleExpiry, Math.min(Math.max(next - now, 0) + 500, 2 ** 31 - 1));
}

// ---- keeping the vault in step -------------------------------------------------------------

let saved: MessagesState | null = null;
useMessages.subscribe((state) => {
  if (!state.loaded || state === saved || !isVaultOpen()) return;
  const before = saved?.items;
  saved = state;
  saveMessages(vault(), state);
  if (before !== state.items) scheduleExpiry();
});

// ---- wiring --------------------------------------------------------------------------------

onLiveMessage((name, payload) => {
  if (name === 'chat') {
    const parsed = chatEventSchema.safeParse(payload);
    if (parsed.success) receive([parsed.data.item]);
  } else if (name === 'chat.gone') {
    const parsed = chatGoneEventSchema.safeParse(payload);
    if (parsed.success) useMessages.setState((state) => withoutItem(state, parsed.data.id));
  }
});

// After every (re)connection: what came meanwhile, and the list of blocked people.
onOnline(() => {
  void refreshBlocked().then(() => catchUp());
});

// A person this phone shares no circle with any more: their items and conversation go
// (docs/ADR/0035 §8, PROTOCOL §8). The block stays: it is the user's own protection.
onPeopleDeparted((people) => {
  if (!loadMessagesOnce()) return;
  useMessages.setState((state) =>
    people.reduce((kept, person) => withoutPerson(kept, person.userId), state),
  );
});

// A circle this phone is no longer in (left, removed, an event that ended): its conversation goes.
onCirclesGone((isGone) => {
  if (!loadMessagesOnce()) return;
  useMessages.setState((state) => {
    let kept = state;
    for (const item of state.items) {
      const target = conversationTarget(item.conversation);
      if ('circleId' in target && isGone(target.circleId))
        kept = withoutCircle(kept, target.circleId);
    }
    return kept;
  });
});

// New keys or trust after a circle reload: items that waited may open now.
const CIRCLES_HASH = JSON.stringify(circlesKey);
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== CIRCLES_HASH || event.type !== 'updated') return;
  const circles = queryClient.getQueryData<Circle[]>(circlesKey);
  if (circles !== undefined && loadMessagesOnce()) {
    useMessages.setState((state) => withoutLapsed(state, circles, useAuth.getState().userId));
  }
  const waiting = useMessages.getState().waitingRecords;
  if (waiting.length > 0) receive(waiting);
});

AppState.addEventListener('change', (state) => {
  if (state === 'active' && useMessages.getState().loaded) scheduleExpiry();
});

// Unencrypted pictures a closed app left in the cache go at once, at every start (QA-38).
sweepPictureFiles();

// Nothing of one account may survive into the next sign-in (the vault itself is destroyed too).
onSignedOut(() => {
  if (expiryTimer !== null) clearTimeout(expiryTimer);
  expiryTimer = null;
  saved = null;
  useMessages.setState(EMPTY_MESSAGES, true);
  useBlocked.setState({ blocked: [] });
  forgetPhotoFiles();
});
