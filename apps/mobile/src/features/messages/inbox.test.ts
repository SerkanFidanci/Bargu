import {
  chatKeyOf,
  type DeviceKeys,
  encryptChat,
  exportDeviceKeyBundle,
  generateDeviceKeys,
  generateSenderKey,
  randomUuid,
  sealDirect,
  type SenderKey,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  CHAT_LIFETIME_MS,
  type ChatPayload,
  type ChatRecord,
  type Circle,
  type MemberCard,
} from '@bargu/schemas';

import { type InboxContext, ingest, openRecord } from './inbox';
import {
  type ChatItem,
  circleConversation,
  EMPTY_MESSAGES,
  personConversation,
  withItem,
} from './messages';

const NOW = 1_800_000_000_000;
const EPOCH = 2;

interface Person {
  userId: string;
  device: DeviceKeys;
}
const somebody = (): Person => ({ userId: randomUuid(), device: generateDeviceKeys(randomUuid()) });
const card = (person: Person): MemberCard => ({
  userId: person.userId,
  role: 'member',
  status: 'active',
  username: null,
  displayName: 'Test',
  avatar: null,
  device: { platform: 'android', bundle: exportDeviceKeyBundle(person.device) },
});
const publicKeys = (person: Person) => verifyDeviceKeyBundle(exportDeviceKeyBundle(person.device));

function setup() {
  const me = somebody();
  const ali = somebody();
  const stranger = somebody();
  const circle: Circle = {
    id: randomUuid(),
    kind: 'friends',
    name: 'Ev',
    epoch: EPOCH,
    epochStartedAt: NOW - 1000,
    myRole: 'member',
    myStatus: 'active',
    members: [card(me), card(ali)],
  };
  const senderKeyOf = (person: Person): SenderKey =>
    generateSenderKey({
      circleId: circle.id,
      epoch: EPOCH,
      senderDeviceId: person.device.deviceId,
    });
  const senderKeys = new Map<string, SenderKey>([
    [me.device.deviceId, senderKeyOf(me)],
    [ali.device.deviceId, senderKeyOf(ali)],
  ]);
  const arrived = new Set([me.device.deviceId, ali.device.deviceId]);
  const untrusted = new Set<string>();
  const blocked = new Set<string>();
  const context: InboxContext = {
    circles: [circle],
    keys: {
      chatKey: (circleId, epoch, deviceId) => {
        const senderKey = senderKeys.get(deviceId);
        if (senderKey === undefined || !arrived.has(deviceId)) return null;
        if (senderKey.circleId !== circleId || senderKey.epoch !== epoch) return null;
        return chatKeyOf(senderKey);
      },
      trusted: (member) => !untrusted.has(member.userId),
      ownPublicKeys: () => publicKeys(me),
    },
    me: me.userId,
    device: me.device,
    blocked,
    now: NOW,
  };
  const text = (words: string, ts = NOW - 1000): ChatPayload => ({
    kind: 'text',
    id: randomUuid(),
    text: words,
    ts,
  });
  const toCircle = (from: Person, payload: ChatPayload, at = NOW - 500): ChatRecord => {
    const senderKey = senderKeys.get(from.device.deviceId);
    if (senderKey === undefined) throw new Error('no sender key');
    return {
      id: payload.id,
      senderId: from.userId,
      circleId: circle.id,
      recipientId: null,
      envelope: encryptChat({ senderKey, sender: from.device, payload }),
      blobId: null,
      at,
    };
  };
  const toPerson = (
    from: Person,
    to: Person,
    payload: ChatPayload,
    at = NOW - 500,
  ): ChatRecord => ({
    id: payload.id,
    senderId: from.userId,
    circleId: null,
    recipientId: to.userId,
    envelope: sealDirect({ sender: from.device, recipient: publicKeys(to), payload }),
    blobId: null,
    at,
  });
  return {
    me,
    ali,
    stranger,
    circle,
    context,
    arrived,
    untrusted,
    blocked,
    text,
    toCircle,
    toPerson,
  };
}

describe('opening one item', () => {
  it('opens a member item of a circle and keeps its envelope for a report', () => {
    const { ali, circle, context, text, toCircle } = setup();
    const payload = text('merhaba');
    const record = toCircle(ali, payload);
    expect(openRecord(record, context)).toEqual({
      payload,
      conversation: circleConversation(circle.id),
      envelope: record.envelope,
    });
  });

  it('opens this phone own circle item without keeping the envelope', () => {
    const { me, context, text, toCircle } = setup();
    const payload = text('benden');
    const opened = openRecord(toCircle(me, payload), context);
    expect(opened).toMatchObject({ payload, envelope: undefined });
  });

  it('waits for a sender key that has not arrived and for a changed key the user has not accepted', () => {
    const { me, ali, context, arrived, untrusted, text, toCircle } = setup();
    const record = toCircle(ali, text('bekle'));
    arrived.delete(ali.device.deviceId);
    expect(openRecord(record, context)).toBe('wait');
    arrived.add(ali.device.deviceId);
    untrusted.add(ali.userId);
    expect(openRecord(record, context)).toBe('wait');

    const mine = toCircle(me, text('benim'));
    arrived.delete(me.device.deviceId);
    expect(openRecord(mine, context)).toBe('drop');
  });

  it('drops what a blocked person sends', () => {
    const { ali, context, blocked, text, toCircle, toPerson, me } = setup();
    blocked.add(ali.userId);
    expect(openRecord(toCircle(ali, text('engelli')), context)).toBe('drop');
    expect(openRecord(toPerson(ali, me, text('engelli')), context)).toBe('drop');
  });

  it('drops an item moved to another circle, changed, or past its 24 hours', () => {
    const { ali, context, text, toCircle } = setup();
    const moved = { ...toCircle(ali, text('taşındı')), circleId: randomUuid() };
    expect(openRecord(moved, context)).toBe('drop');

    const record = toCircle(ali, text('değişti'));
    if (!('circleId' in record.envelope)) throw new Error('circle item');
    const changed = { ...record, envelope: { ...record.envelope, epoch: EPOCH + 1 } };
    expect(openRecord(changed, context)).toBe('wait');
    const other = toCircle(ali, text('başka'));
    const swapped = { ...record, envelope: { ...record.envelope, ct: other.envelope.ct } };
    expect(openRecord(swapped, context)).toBe('drop');

    const old = toCircle(ali, text('eski', NOW - CHAT_LIFETIME_MS - 1));
    expect(openRecord(old, context)).toBe('drop');
  });

  it('opens an item sent to this person as the sender own conversation', () => {
    const { me, ali, context, text, toPerson } = setup();
    const payload = text('sadece sana');
    const record = toPerson(ali, me, payload);
    expect(openRecord(record, context)).toEqual({
      payload,
      conversation: personConversation(ali.userId),
      envelope: record.envelope,
    });
  });

  it('drops an item for someone else, its own sealed copy, and one from a stranger waits', () => {
    const { me, ali, stranger, context, text, toPerson } = setup();
    expect(openRecord(toPerson(ali, stranger, text('başkasına')), context)).toBe('drop');
    expect(openRecord(toPerson(me, ali, text('benimki')), context)).toBe('drop');
    expect(openRecord(toPerson(stranger, me, text('tanımadık')), context)).toBe('wait');
  });
});

describe('taking items in', () => {
  it('adds each item once and moves the cursor to the newest', () => {
    const { ali, context, text, toCircle } = setup();
    const first = toCircle(ali, text('bir'), NOW - 900);
    const second = toCircle(ali, text('iki'), NOW - 800);
    const state = ingest(EMPTY_MESSAGES, [first, second], context);
    expect(state.items.map((item) => item.text)).toEqual(['bir', 'iki']);
    expect(state.cursor).toBe(NOW - 800);
    expect(ingest(state, [first, second], context)).toMatchObject({ items: state.items });
  });

  it('remembers a dropped item so it is not tried again', () => {
    const { ali, context, blocked, text, toCircle } = setup();
    blocked.add(ali.userId);
    const record = toCircle(ali, text('engelli'));
    const state = ingest(EMPTY_MESSAGES, [record], context);
    expect(state.items).toEqual([]);
    expect(state.seen[record.id]).toBe(record.at);
    expect(state.cursor).toBe(record.at);
  });

  it('keeps the cursor before an item waiting for its key, and opens it when the key comes', () => {
    const { ali, context, arrived, text, toCircle } = setup();
    const waiting = toCircle(ali, text('bekleyen'), NOW - 900);
    const later = toCircle(ali, text('sonraki'), NOW - 800);
    arrived.delete(ali.device.deviceId);
    const state = ingest(EMPTY_MESSAGES, [waiting, later], context);
    expect(state.waitingRecords.map((record) => record.id)).toEqual([waiting.id, later.id]);
    expect(state.cursor).toBe(NOW - 901);

    arrived.add(ali.device.deviceId);
    const opened = ingest(state, state.waitingRecords, context);
    expect(opened.waitingRecords).toEqual([]);
    expect(opened.items.map((item) => item.text)).toEqual(['bekleyen', 'sonraki']);
    expect(opened.cursor).toBe(NOW - 800);
  });
});

describe('screenshot notices', () => {
  it('mark only this phone own photo, and drop one about anyone else', () => {
    const { me, ali, context, toPerson } = setup();
    const photoOf = (from: string): ChatItem => ({
      id: randomUuid(),
      conversation: personConversation(ali.userId),
      from,
      at: NOW - 5000,
      kind: 'photo',
      state: 'sent',
      photo: {
        blobId: randomUuid(),
        key: 'k'.repeat(43),
        size: 1000,
        hash: 'h'.repeat(43),
        w: 10,
        h: 10,
        story: false,
      },
    });
    const mine = photoOf(me.userId);
    const theirs = photoOf(randomUuid());
    const start = withItem(withItem(EMPTY_MESSAGES, mine), theirs);
    const shot = (target: string): ChatPayload => ({
      kind: 'shot',
      id: randomUuid(),
      target,
      ts: NOW - 100,
    });
    const aboutMine = toPerson(ali, me, shot(mine.id));
    const aboutTheirs = toPerson(ali, me, shot(theirs.id));
    const state = ingest(start, [aboutMine, aboutTheirs], context);
    expect(state.items.find((item) => item.id === mine.id)?.shotBy).toEqual([ali.userId]);
    expect(state.items.find((item) => item.id === theirs.id)?.shotBy).toBeUndefined();
    expect(state.seen[aboutTheirs.id]).toBe(aboutTheirs.at);
  });

  it('a story seen: marks only this phone own one, drops one about anyone else (Ek 1)', () => {
    const { me, ali, context, toPerson } = setup();
    const storyOf = (from: string): ChatItem => ({
      id: randomUuid(),
      conversation: personConversation(ali.userId),
      from,
      at: NOW - 5000,
      kind: 'photo',
      state: 'sent',
      photo: {
        blobId: randomUuid(),
        key: 'k'.repeat(43),
        size: 1000,
        hash: 'h'.repeat(43),
        w: 10,
        h: 10,
        story: true,
      },
    });
    const mine = storyOf(me.userId);
    const theirs = storyOf(randomUuid());
    const start = withItem(withItem(EMPTY_MESSAGES, mine), theirs);
    const view = (target: string): ChatPayload => ({
      kind: 'view',
      id: randomUuid(),
      target,
      ts: NOW - 100,
    });
    const aboutMine = toPerson(ali, me, view(mine.id));
    const aboutTheirs = toPerson(ali, me, view(theirs.id));
    const state = ingest(start, [aboutMine, aboutTheirs], context);
    expect(state.items.find((item) => item.id === mine.id)?.viewers).toEqual({
      [ali.userId]: NOW - 100,
    });
    expect(state.items.find((item) => item.id === theirs.id)?.viewers).toBeUndefined();
    expect(state.seen[aboutTheirs.id]).toBe(aboutTheirs.at);
    // Nothing of it shows as an item of the conversation.
    expect(state.items).toHaveLength(2);
  });
});
