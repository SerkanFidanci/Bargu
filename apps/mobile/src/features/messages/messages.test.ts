import { randomUuid } from '@bargu/crypto';
import { CHAT_LIFETIME_MS, type ChatReaction } from '@bargu/schemas';

import type { KeyValueStore } from '../storage/vault';
import {
  applyPayload,
  type ChatItem,
  circleConversation,
  conversations,
  EMPTY_MESSAGES,
  expired,
  loadMessages,
  MESSAGES_KEY,
  type MessagesState,
  itemsOf,
  nextExpiry,
  personConversation,
  saveMessages,
  storiesOf,
  unreadIn,
  unreadTotal,
  viewersOf,
  withItem,
  withoutCircle,
  withoutItem,
  withoutPerson,
  withReaction,
  withSentTo,
  withState,
  withViewed,
} from './messages';
import { storyRingKey, storyRingsOf } from './stories';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (key) => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
    delete: (key) => {
      data.delete(key);
    },
    keys: () => [...data.keys()],
    clear: () => {
      data.clear();
    },
  };
}

const NOW = 1_800_000_000_000;
const ME = randomUuid();
const ALI = randomUuid();
const CIRCLE = randomUuid();
const group = circleConversation(CIRCLE);
const withAli = personConversation(ALI);

const text = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: randomUuid(),
  conversation: group,
  from: ALI,
  at: NOW - 1000,
  kind: 'text',
  text: 'merhaba',
  state: 'sent',
  ...overrides,
});

const photo = (overrides: Partial<ChatItem> = {}): ChatItem => ({
  id: randomUuid(),
  conversation: group,
  from: ALI,
  at: NOW - 1000,
  kind: 'photo',
  state: 'sent',
  photo: {
    blobId: randomUuid(),
    key: 'k'.repeat(43),
    size: 1000,
    hash: 'h'.repeat(43),
    w: 100,
    h: 100,
    story: false,
  },
  ...overrides,
});

const stateWith = (...items: ChatItem[]): MessagesState =>
  items.reduce((state, item) => withItem(state, item), EMPTY_MESSAGES);

describe('the vault copy', () => {
  it('keeps the items of the last 24 hours and drops the older ones from the vault too', () => {
    const store = memoryStore();
    const fresh = text();
    const old = text({ at: NOW - CHAT_LIFETIME_MS - 1 });
    saveMessages(store, stateWith(fresh, old));

    const loaded = loadMessages(store, NOW);

    expect(loaded.items.map((item) => item.id)).toEqual([fresh.id]);
    expect(loadMessages(store, NOW).items).toHaveLength(1);
    expect(JSON.parse(store.get(MESSAGES_KEY) ?? '{}')).toMatchObject({
      items: [{ id: fresh.id }],
    });
  });

  it('starts empty and forgets a broken copy', () => {
    const store = memoryStore();
    expect(loadMessages(store, NOW).items).toEqual([]);
    store.set(MESSAGES_KEY, '{nope');
    expect(loadMessages(store, NOW).items).toEqual([]);
    expect(store.get(MESSAGES_KEY)).toBeUndefined();
    store.set(
      MESSAGES_KEY,
      JSON.stringify({ items: [{ id: 'x' }], read: {}, cursor: 0, seen: {} }),
    );
    expect(loadMessages(store, NOW).items).toEqual([]);
    expect(store.get(MESSAGES_KEY)).toBeUndefined();
  });

  it('never writes what lives only in memory, and deletes the copy when nothing is left', () => {
    const store = memoryStore();
    const full: MessagesState = { ...stateWith(text()), loaded: true };
    saveMessages(store, full);
    const saved: unknown = JSON.parse(store.get(MESSAGES_KEY) ?? '{}');
    expect(Object.keys(saved as object).sort()).toEqual([
      'cursor',
      'items',
      'read',
      'seen',
      'viewed',
    ]);

    saveMessages(store, EMPTY_MESSAGES);
    expect(store.get(MESSAGES_KEY)).toBeUndefined();
  });
});

describe('the 24 hours', () => {
  it('gives the same state back when nothing is over', () => {
    const state = stateWith(text());
    expect(expired(state, NOW)).toBe(state);
  });

  it('drops what is over, and forgets seen ids an hour after their day', () => {
    const old = text({ at: NOW - CHAT_LIFETIME_MS - 1 });
    const state = stateWith(old, text());
    const later = expired(state, NOW);
    expect(later.items).toHaveLength(1);
    expect(later.seen[old.id]).toBe(old.at);

    expect(expired(state, NOW + 60 * 60_000 + 1).seen[old.id]).toBeUndefined();
  });

  it('knows when the next item goes', () => {
    expect(nextExpiry(EMPTY_MESSAGES)).toBeNull();
    const first = text({ at: NOW - 5000 });
    expect(nextExpiry(stateWith(text(), first))).toBe(first.at + CHAT_LIFETIME_MS);
  });
});

describe('items', () => {
  it('adds an item once, in time order, and marks it seen', () => {
    const late = text({ at: NOW });
    const early = text({ at: NOW - 5000 });
    const state = stateWith(late, early);
    expect(state.items.map((item) => item.id)).toEqual([early.id, late.id]);
    expect(withItem(state, late)).toBe(state);
    expect(state.seen[late.id]).toBe(late.at);
  });

  it('keeps the newest thousand of a conversation', () => {
    let state: MessagesState = EMPTY_MESSAGES;
    for (let index = 0; index < 1001; index += 1) {
      state = withItem(state, text({ at: NOW - 2000 + index }));
    }
    const other = text({ conversation: withAli });
    state = withItem(state, other);
    expect(state.items.filter((item) => item.conversation === group)).toHaveLength(1000);
    expect(state.items.some((item) => item.at === NOW - 2000)).toBe(false);
    expect(state.items).toContainEqual(other);
  });

  it('changes the state of one item and removes one', () => {
    const mine = text({ from: ME, state: 'sending' });
    const state = withState(stateWith(mine, text()), mine.id, 'failed');
    expect(state.items.find((item) => item.id === mine.id)?.state).toBe('failed');
    expect(withoutItem(state, mine.id).items).toHaveLength(1);
    expect(withoutItem(state, randomUuid())).toBe(state);
  });
});

describe('what an opened item does', () => {
  it('adds a text with what it answers and keeps its envelope only when given', () => {
    const answered = randomUuid();
    const id = randomUuid();
    const state = applyPayload(
      EMPTY_MESSAGES,
      { kind: 'text', id, text: 'selam', ts: NOW, replyTo: answered },
      ALI,
      group,
      undefined,
    );
    expect(state.items).toEqual([
      {
        id,
        conversation: group,
        from: ALI,
        at: NOW,
        kind: 'text',
        text: 'selam',
        replyTo: answered,
        state: 'sent',
      },
    ]);
    expect(state.seen[id]).toBe(NOW);
  });

  it('adds a photo with its key and caption', () => {
    const id = randomUuid();
    const blobId = randomUuid();
    const state = applyPayload(
      EMPTY_MESSAGES,
      {
        kind: 'photo',
        id,
        blobId,
        key: 'k'.repeat(43),
        size: 2000,
        hash: 'h'.repeat(43),
        w: 1600,
        h: 1200,
        story: true,
        caption: 'deniz',
        ts: NOW,
      },
      ALI,
      group,
      undefined,
    );
    expect(state.items[0]?.photo).toEqual({
      blobId,
      key: 'k'.repeat(43),
      size: 2000,
      hash: 'h'.repeat(43),
      w: 1600,
      h: 1200,
      story: true,
      caption: 'deniz',
    });
  });

  it('takes an item back only for its own sender', () => {
    const hers = text();
    const mine = text({ from: ME });
    const state = stateWith(hers, mine);

    const fromAli = applyPayload(
      state,
      { kind: 'del', id: randomUuid(), target: hers.id, ts: NOW },
      ALI,
      group,
      undefined,
    );
    expect(fromAli.items.map((item) => item.id)).toEqual([mine.id]);

    const forged = applyPayload(
      state,
      { kind: 'del', id: randomUuid(), target: mine.id, ts: NOW },
      ALI,
      group,
      undefined,
    );
    expect(forged.items).toHaveLength(2);
  });

  it('marks this phone own photo as screenshot, once per person, and nothing else', () => {
    const mine = photo({ from: ME });
    const hers = photo();
    const words = text({ from: ME });
    const state = stateWith(mine, hers, words);
    const shot = (target: string, from: string, current: MessagesState) =>
      applyPayload(
        current,
        { kind: 'shot', id: randomUuid(), target, ts: NOW },
        from,
        group,
        undefined,
      );

    const twice = shot(mine.id, ALI, shot(mine.id, ALI, state));
    expect(twice.items.find((item) => item.id === mine.id)?.shotBy).toEqual([ALI]);
    expect(
      shot(hers.id, ALI, state).items.find((item) => item.id === hers.id)?.shotBy,
    ).toBeUndefined();
    expect(
      shot(words.id, ALI, state).items.find((item) => item.id === words.id)?.shotBy,
    ).toBeUndefined();
  });

  it('marks who saw this phone own story, the first time each, and nothing else (Ek 1)', () => {
    const blobId = randomUuid();
    const AYSE = randomUuid();
    const asStory = (item: ChatItem): ChatItem => {
      const file = item.photo ?? photo().photo;
      return file === undefined
        ? item
        : { ...item, photo: { ...file, blobId, story: true }, sentTo: [ALI, AYSE] };
    };
    // One story, gone to two circles: an item in each, the same file.
    const inGroup = asStory(photo({ from: ME }));
    const inOther = asStory(photo({ from: ME, conversation: circleConversation(randomUuid()) }));
    const hers = asStory(photo());
    const notStory = photo({ from: ME });
    const state = stateWith(inGroup, inOther, hers, notStory);
    const view = (target: string, from: string, ts: number, current: MessagesState) =>
      applyPayload(current, { kind: 'view', id: randomUuid(), target, ts }, from, group, undefined);
    const viewersAt = (current: MessagesState, id: string) =>
      current.items.find((item) => item.id === id)?.viewers;

    let next = view(inGroup.id, ALI, NOW - 500, state);
    next = view(inGroup.id, ALI, NOW - 100, next);
    next = view(inOther.id, AYSE, NOW - 300, next);
    expect(viewersAt(next, inGroup.id)).toEqual({ [ALI]: NOW - 500 });
    expect(viewersOf(next, ME, blobId)).toEqual([
      { userId: AYSE, at: NOW - 300 },
      { userId: ALI, at: NOW - 500 },
    ]);
    // Someone else's story, a photo that is no story, or one's own view: nothing.
    expect(viewersAt(view(hers.id, ALI, NOW, state), hers.id)).toBeUndefined();
    expect(viewersAt(view(notStory.id, ALI, NOW, state), notStory.id)).toBeUndefined();
    expect(viewersAt(view(inGroup.id, ME, NOW, state), inGroup.id)).toBeUndefined();
    expect(viewersOf(state, ME, blobId)).toEqual([]);
    expect(viewersOf(next, ALI, blobId)).toEqual([]);
  });

  it('takes a view only from someone the story went to: no one else can claim it (Ek 1)', () => {
    const story = (sentTo: string[] | undefined): ChatItem => {
      const base = photo({ from: ME });
      return {
        ...base,
        photo: { ...(base.photo ?? ({} as never)), story: true },
        ...(sentTo === undefined ? {} : { sentTo }),
      };
    };
    const toAli = story([ALI]);
    const toOthers = story([randomUuid()]);
    // Sent before the phone kept whom it went to: nobody can be checked, so nobody counts.
    const unknown = story(undefined);
    const state = stateWith(toAli, toOthers, unknown);
    const viewers = (target: string) =>
      applyPayload(
        state,
        { kind: 'view', id: randomUuid(), target, ts: NOW },
        ALI,
        personConversation(ALI),
        undefined,
      ).items.find((item) => item.id === target)?.viewers;

    expect(viewers(toAli.id)).toEqual({ [ALI]: NOW });
    expect(viewers(toOthers.id)).toBeUndefined();
    expect(viewers(unknown.id)).toBeUndefined();
  });

  it('takes a reaction from the conversation the item is in, one each, and its taking back (Ek 2)', () => {
    const AYSE = randomUuid();
    const inGroup = text();
    const toAli = text({ conversation: withAli, from: ME });
    const state = stateWith(inGroup, toAli);
    const react = (
      current: MessagesState,
      target: string,
      from: string,
      emoji: ChatReaction | null,
      conversation = group,
    ) =>
      applyPayload(
        current,
        { kind: 'react', id: randomUuid(), target, emoji, ts: NOW },
        from,
        conversation,
        undefined,
      );
    const reactionsAt = (current: MessagesState, id: string) =>
      current.items.find((item) => item.id === id)?.reactions;

    let next = react(state, inGroup.id, ALI, '❤️');
    next = react(next, inGroup.id, AYSE, '😂');
    next = react(next, inGroup.id, ALI, '🔥');
    expect(reactionsAt(next, inGroup.id)).toEqual({ [ALI]: '🔥', [AYSE]: '😂' });
    expect(reactionsAt(react(next, inGroup.id, AYSE, null), inGroup.id)).toEqual({ [ALI]: '🔥' });
    // Ali in his own conversation with this phone: yes; the same item named from another one: no.
    expect(reactionsAt(react(state, toAli.id, ALI, '👍', withAli), toAli.id)).toEqual({
      [ALI]: '👍',
    });
    expect(reactionsAt(react(state, toAli.id, AYSE, '👍', group), toAli.id)).toBeUndefined();
    // It adds nothing to the conversation.
    expect(next.items).toHaveLength(2);
    // This phone's own, shown at once.
    expect(withReaction(state, inGroup.id, ME, '😮').items[0]?.reactions).toEqual({ [ME]: '😮' });
  });

  it('takes a reaction to a story only from someone it went to (Ek 2, as Ek 1)', () => {
    const base = photo({ from: ME });
    const mine: ChatItem = {
      ...base,
      photo: { ...(base.photo ?? ({} as never)), story: true },
      sentTo: [ALI],
    };
    const hersBase = photo();
    const hers: ChatItem = {
      ...hersBase,
      photo: { ...(hersBase.photo ?? ({} as never)), story: true },
    };
    const state = stateWith(mine, hers);
    const react = (target: string, from: string) =>
      applyPayload(
        state,
        { kind: 'react', id: randomUuid(), target, emoji: '❤️', ts: NOW },
        from,
        personConversation(from),
        undefined,
      ).items.find((item) => item.id === target)?.reactions;
    expect(react(mine.id, ALI)).toEqual({ [ALI]: '❤️' });
    expect(react(mine.id, randomUuid())).toBeUndefined();
    // Someone else's story: nobody tells this phone about it.
    expect(react(hers.id, randomUuid())).toBeUndefined();
  });

  it('forgets what a person left on this phone own items when they go (QA-39)', () => {
    const AYSE = randomUuid();
    const base = photo({ from: ME });
    const mine: ChatItem = {
      ...base,
      photo: { ...(base.photo ?? ({} as never)), story: true },
      sentTo: [ALI, AYSE],
      viewers: { [ALI]: NOW - 10, [AYSE]: NOW - 5 },
      reactions: { [ALI]: '❤️', [AYSE]: '🔥' },
      shotBy: [ALI],
    };
    const left = withoutPerson(stateWith(mine), ALI).items[0];
    expect(left?.viewers).toEqual({ [AYSE]: NOW - 5 });
    expect(left?.reactions).toEqual({ [AYSE]: '🔥' });
    expect(left?.shotBy).toEqual([]);
    expect(left?.sentTo).toEqual([AYSE]);
    // An item that never had any of it gains nothing.
    expect(withoutPerson(stateWith(text()), ALI).items[0]?.viewers).toBeUndefined();
  });

  it('keeps everyone a story went to, also across a second try', () => {
    const AYSE = randomUuid();
    const mine = photo({ from: ME });
    const once = withSentTo(stateWith(mine), mine.id, [ALI]);
    const twice = withSentTo(once, mine.id, [ALI, AYSE]);
    expect(twice.items[0]?.sentTo).toEqual([ALI, AYSE]);
    // Nobody: nothing written (a text is never marked).
    expect(withSentTo(once, mine.id, [])).toBe(once);
  });
});

describe('leaving', () => {
  it('forgets a person: their conversation and what they wrote anywhere', () => {
    const inGroup = text();
    const direct = text({ conversation: withAli, from: ME });
    const mineInGroup = text({ from: ME });
    const state = {
      ...stateWith(inGroup, direct, mineInGroup),
      read: { [withAli]: NOW, [group]: NOW },
    };
    const left = withoutPerson(state, ALI);
    expect(left.items.map((item) => item.id)).toEqual([mineInGroup.id]);
    expect(left.read).toEqual({ [group]: NOW });
  });

  it('forgets a circle', () => {
    const direct = text({ conversation: withAli });
    const state = { ...stateWith(text(), direct), read: { [group]: NOW } };
    const left = withoutCircle(state, CIRCLE);
    expect(left.items).toEqual([direct]);
    expect(left.read).toEqual({});
  });
});

describe('unread', () => {
  it('counts what others sent after the conversation was read', () => {
    const state = {
      ...stateWith(
        text({ at: NOW - 3000 }),
        text({ at: NOW - 1000 }),
        text({ at: NOW, from: ME }),
        text({ conversation: withAli, at: NOW }),
      ),
      read: { [group]: NOW - 2000 },
    };
    expect(unreadIn(state, group, ME)).toBe(1);
    expect(unreadIn(state, withAli, ME)).toBe(1);
    expect(unreadTotal(state, ME)).toBe(2);
  });

  it('lists conversations by their last item, the newest first', () => {
    const lastInGroup = text({ at: NOW - 100 });
    const lastWithAli = text({ conversation: withAli, at: NOW });
    const state = stateWith(text({ at: NOW - 500 }), lastInGroup, lastWithAli);
    expect(conversations(state)).toEqual([
      { conversation: withAli, last: lastWithAli },
      { conversation: group, last: lastInGroup },
    ]);
  });
});

describe('stories', () => {
  const OTHER = randomUuid();
  const story = (overrides: Partial<ChatItem> = {}, blobId = randomUuid()): ChatItem => {
    const base = photo(overrides);
    if (base.photo === undefined) throw new Error('a photo');
    return { ...base, photo: { ...base.photo, blobId, story: true } };
  };

  it('are not items of their conversation: not listed, not counted, not the last one', () => {
    const shared = story({ at: NOW });
    const words = text({ at: NOW - 5000 });
    const state = stateWith(words, shared);
    expect(itemsOf(state, group)).toEqual([words]);
    expect(unreadIn(state, group, ME)).toBe(1);
    expect(unreadTotal(state, ME)).toBe(1);
    expect(conversations(state)).toEqual([{ conversation: group, last: words }]);
  });

  it('count a photo shared to several circles once, and only once it went', () => {
    const blobId = randomUuid();
    const first = story({ at: NOW - 3000 }, blobId);
    const second = story(
      { at: NOW - 3000, conversation: circleConversation(randomUuid()) },
      blobId,
    );
    const later = story({ at: NOW - 1000 });
    const going = story({ from: ME, state: 'sending' });
    const [ali] = storiesOf(stateWith(first, second, later, going), ME);
    expect(ali?.stories.map((item) => item.photo?.blobId)).toEqual([blobId, later.photo?.blobId]);
    expect(storiesOf(stateWith(going), ME)).toEqual([]);
  });

  it("put the user's own first, then the unseen, then the newest", () => {
    const mine = story({ from: ME, at: NOW - 9000 });
    const seenOne = story({ at: NOW - 100 });
    const fresh = story({ from: OTHER, at: NOW - 5000 });
    const state = withViewed(stateWith(mine, seenOne, fresh), seenOne.photo?.blobId ?? '', NOW);
    expect(storiesOf(state, ME).map((person) => [person.userId, person.unseen])).toEqual([
      [ME, false],
      [OTHER, true],
      [ALI, false],
    ]);
  });

  it('remember what was seen for 24 hours, once', () => {
    const state = withViewed(EMPTY_MESSAGES, 'file', NOW);
    expect(withViewed(state, 'file', NOW + 1)).toBe(state);
    expect(expired(state, NOW + CHAT_LIFETIME_MS - 1).viewed).toEqual({ file: NOW });
    expect(expired(state, NOW + CHAT_LIFETIME_MS + 1).viewed).toEqual({});
  });
});

describe('story rings on the map', () => {
  it('come as a short text that changes only when a ring does, and back', () => {
    const blob = randomUuid();
    const base = photo({ at: NOW - 100 });
    if (base.photo === undefined) throw new Error('a photo');
    const shared: ChatItem = { ...base, photo: { ...base.photo, blobId: blob, story: true } };
    const state = stateWith(shared);
    const key = storyRingKey(state, ME);
    expect(key).toBe(`${ALI}:n`);
    expect(storyRingKey(withItem(state, text()), ME)).toBe(key);
    const seen = storyRingKey(withViewed(state, blob, NOW), ME);
    expect(storyRingsOf(seen)).toEqual(new Map([[ALI, 'seen']]));
    expect(storyRingsOf('')).toEqual(new Map());
  });
});

describe('a story that did not go (QA-38 Y1)', () => {
  it('shows in the conversation it did not reach, to be tried again', () => {
    const base = photo({ from: ME, state: 'failed' });
    if (base.photo === undefined) throw new Error('a photo');
    const failed: ChatItem = { ...base, photo: { ...base.photo, story: true } };
    const went: ChatItem = { ...failed, id: randomUuid(), state: 'sent' };
    expect(itemsOf(stateWith(failed, went), group)).toEqual([failed]);
  });
});
