import {
  exportDeviceKeyBundle,
  generateDeviceKeys,
  generateSenderKey,
  randomUuid,
  type SenderKey,
} from '@bargu/crypto';
import type { ChatPayload, Circle } from '@bargu/schemas';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
// photo.ts reads the image tools' native modules, which a Linux run (CI) does not have.
jest.mock('expo-file-system', () => ({ File: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ ImageManipulator: {}, SaveFormat: { JPEG: 'jpeg' } }));
const mockSenderKeys = new Map<string, SenderKey>();
jest.mock('../live/live-session', () => ({
  keys: () => ({
    ownKey: (circle: { id: string }) => mockSenderKeys.get(circle.id),
    trusted: () => true,
  }),
}));
const mockUpload = jest.fn<Promise<void>, [string, Uint8Array]>(() => Promise.resolve());
const mockToCircle = jest.fn<Promise<{ ok: true }>, [string, unknown, unknown, string?]>(() =>
  Promise.resolve({ ok: true }),
);
const mockToPerson = jest.fn<Promise<{ ok: true }>, [string, unknown, unknown]>(() =>
  Promise.resolve({ ok: true }),
);
jest.mock('./messages-api', () => ({
  messagesApi: {
    upload: (blobId: string, sealed: Uint8Array) => mockUpload(blobId, sealed),
    toCircle: (circleId: string, envelope: unknown, pushes: unknown, blobId?: string) =>
      mockToCircle(circleId, envelope, pushes, blobId),
    toPerson: (userId: string, envelope: unknown, pushes: unknown) =>
      mockToPerson(userId, envelope, pushes),
  },
}));

import { useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { queryClient } from '../query-client';
import { EMPTY_MESSAGES, useMessages } from './messages';
import { ApiError } from '../auth/api-client';
import { type ChatItem } from './messages';
import {
  pushOf,
  react,
  sendHeldNotices,
  shareStory,
  storyTargets,
  tellScreenshot,
  tellViewed,
} from './outbox';
import { rulesWereAccepted } from './rules-state';
import { sealPhoto } from './photo';

const ME = randomUuid();
const NOW = 1_800_000_000_000;

afterAll(() => {
  queryClient.clear();
});

describe('what a closed app is told of an item', () => {
  const circleId = randomUuid();
  const photo = (story: boolean): ChatPayload => ({
    kind: 'photo',
    id: randomUuid(),
    blobId: randomUuid(),
    key: 'k'.repeat(43),
    size: 1000,
    hash: 'h'.repeat(43),
    w: 10,
    h: 10,
    story,
    ts: NOW,
  });

  it('who sent a text or a photo, in a circle or alone, and never what it says', () => {
    expect(pushOf({ kind: 'text', id: randomUuid(), text: 'gizli', ts: NOW }, circleId)).toEqual({
      kind: 'chat',
      circleId,
      photo: false,
      ts: NOW,
    });
    expect(pushOf(photo(false), undefined)).toEqual({ kind: 'chat', photo: true, ts: NOW });
  });

  it('a story as a story, a screenshot as one, and nothing of an item taken back', () => {
    expect(pushOf(photo(true), circleId)).toEqual({ kind: 'moment', circleId, ts: NOW });
    // A story to a friend alone (a friendship talks as the two people): a story all the same.
    expect(pushOf(photo(true), undefined)).toEqual({ kind: 'moment', ts: NOW });
    expect(
      pushOf({ kind: 'shot', id: randomUuid(), target: randomUuid(), ts: NOW }, undefined),
    ).toEqual({ kind: 'shot', ts: NOW });
    // A story seen tells its sender nothing they would be woken for (Ek 1).
    expect(
      pushOf({ kind: 'view', id: randomUuid(), target: randomUuid(), ts: NOW }, undefined),
    ).toBeNull();
    expect(
      pushOf({ kind: 'del', id: randomUuid(), target: randomUuid(), ts: NOW }, circleId),
    ).toBeNull();
    // Nor does a reaction (Ek 2).
    expect(
      pushOf(
        { kind: 'react', id: randomUuid(), target: randomUuid(), emoji: '❤️', ts: NOW },
        circleId,
      ),
    ).toBeNull();
  });
});

describe('where a story goes (QA-38 Y1)', () => {
  const member = (userId: string) => ({
    userId,
    role: 'member' as const,
    status: 'active' as const,
    username: null,
    displayName: 'Test',
    avatar: null,
    device: null,
  });
  it('to a circle as the circle, to a friendship as the friend alone, each place once', () => {
    const FRIEND = randomUuid();
    const pair: Circle = {
      id: randomUuid(),
      kind: 'pair',
      name: null,
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'owner',
      myStatus: 'active',
      members: [member(ME), member(FRIEND)],
    };
    const family: Circle = {
      ...pair,
      id: randomUuid(),
      kind: 'family',
      name: 'Aile',
      members: [member(ME), member(randomUuid())],
    };
    expect(storyTargets([family.id, pair.id, pair.id], [family, pair], ME)).toEqual([
      `c:${family.id}`,
      `p:${FRIEND}`,
    ]);
    // The friend is in a chosen circle too: one item, one notification, there (QA-38b).
    const withFriend: Circle = { ...family, members: [member(ME), member(FRIEND)] };
    expect(storyTargets([withFriend.id, pair.id], [withFriend, pair], ME)).toEqual([
      `c:${withFriend.id}`,
    ]);
    // Not chosen, that circle does not count.
    expect(storyTargets([pair.id], [withFriend, pair], ME)).toEqual([`p:${FRIEND}`]);
  });
});

describe('a story', () => {
  it('uploads its file once and sends an item of its own to each circle', async () => {
    const device = generateDeviceKeys(randomUuid());
    useAuth.setState({ userId: ME, device });
    useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
    const person = (userId: string, status: 'active' | 'invited') => ({
      userId,
      role: 'member' as const,
      status,
      username: null,
      displayName: 'Test',
      avatar: null,
      device: null,
    });
    const ALI = randomUuid();
    const AYSE = randomUuid();
    const circle = (name: string, members: Circle['members']): Circle => ({
      id: randomUuid(),
      kind: 'family',
      name,
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member',
      myStatus: 'active',
      members,
    });
    const circles = [
      // Someone only invited is not in it yet: the story does not go to them.
      circle('Aile', [
        person(ME, 'active'),
        person(ALI, 'active'),
        person(randomUuid(), 'invited'),
      ]),
      circle('Okul', [person(ME, 'active'), person(AYSE, 'active')]),
    ];
    for (const each of circles) {
      mockSenderKeys.set(
        each.id,
        generateSenderKey({ circleId: each.id, epoch: 1, senderDeviceId: device.deviceId }),
      );
    }
    queryClient.setQueryData(circlesKey, circles);
    const file = sealPhoto({ jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), w: 10, h: 10 });

    await expect(
      shareStory(
        circles.map((each) => each.id),
        file,
        'deniz',
      ),
    ).resolves.toEqual({ result: 'sent', failed: 0, total: 2 });

    expect(mockUpload).toHaveBeenCalledTimes(1);
    expect(mockUpload.mock.calls[0]?.[0]).toBe(file.blobId);
    expect(mockToCircle.mock.calls.map((call) => [call[0], call[3]])).toEqual(
      circles.map((each) => [each.id, file.blobId]),
    );
    const items = useMessages.getState().items;
    expect(items).toHaveLength(2);
    expect(new Set(items.map((item) => item.id)).size).toBe(2);
    expect(items.every((item) => item.photo?.story === true && item.state === 'sent')).toBe(true);
    expect(items.every((item) => item.photo?.caption === 'deniz')).toBe(true);
    // Each item keeps whom it went to: only they can say they saw it (docs/ADR/0035 Ek 1).
    expect(items.map((item) => item.sentTo)).toEqual([[ALI], [AYSE]]);
  });
});

describe('a screenshot notice (QA-38b)', () => {
  it('is kept while the server has no record of the rules, and goes once they are accepted', async () => {
    const device = generateDeviceKeys(randomUuid());
    useAuth.setState({ userId: ME, device });
    const sender = { userId: randomUuid(), device: generateDeviceKeys(randomUuid()) };
    const circle: Circle = {
      id: randomUuid(),
      kind: 'family',
      name: 'Aile',
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member',
      myStatus: 'active',
      members: [
        {
          userId: sender.userId,
          role: 'member',
          status: 'active',
          username: null,
          displayName: 'Ali',
          avatar: null,
          device: { platform: 'android', bundle: exportDeviceKeyBundle(sender.device) },
        },
      ],
    };
    queryClient.setQueryData(circlesKey, [circle]);
    const photo: ChatItem = {
      id: randomUuid(),
      conversation: `c:${circle.id}`,
      from: sender.userId,
      at: NOW,
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
    };
    mockToPerson.mockRejectedValueOnce(new ApiError(403, 'RULES_REQUIRED'));
    await tellScreenshot(photo);
    expect(mockToPerson).toHaveBeenCalledTimes(1);

    rulesWereAccepted({ rules: { version: 1, at: NOW } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockToPerson).toHaveBeenCalledTimes(2);
    expect(mockToPerson.mock.calls[1]?.[0]).toBe(sender.userId);
    // Sent: nothing is kept any more.
    rulesWereAccepted({ rules: { version: 1, at: NOW } });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mockToPerson).toHaveBeenCalledTimes(2);
  });
});

describe('a story seen (docs/ADR/0035 Ek 1)', () => {
  it('tells its sender alone, never for one own story or a photo, and tries again if not sent', async () => {
    const device = generateDeviceKeys(randomUuid());
    useAuth.setState({ userId: ME, device });
    const sender = { userId: randomUuid(), device: generateDeviceKeys(randomUuid()) };
    const circle: Circle = {
      id: randomUuid(),
      kind: 'family',
      name: 'Aile',
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member',
      myStatus: 'active',
      members: [
        {
          userId: sender.userId,
          role: 'member',
          status: 'active',
          username: null,
          displayName: 'Ali',
          avatar: null,
          device: { platform: 'android', bundle: exportDeviceKeyBundle(sender.device) },
        },
      ],
    };
    queryClient.setQueryData(circlesKey, [circle]);
    const storyFrom = (from: string, story: boolean): ChatItem => ({
      id: randomUuid(),
      conversation: `c:${circle.id}`,
      from,
      at: NOW,
      kind: 'photo',
      state: 'sent',
      photo: {
        blobId: randomUuid(),
        key: 'k'.repeat(43),
        size: 1000,
        hash: 'h'.repeat(43),
        w: 10,
        h: 10,
        story,
      },
    });
    mockToPerson.mockClear();

    await tellViewed(storyFrom(ME, true));
    await tellViewed(storyFrom(sender.userId, false));
    expect(mockToPerson).not.toHaveBeenCalled();

    mockToPerson.mockRejectedValueOnce(new Error('offline'));
    await tellViewed(storyFrom(sender.userId, true));
    expect(mockToPerson).toHaveBeenCalledTimes(1);
    expect(mockToPerson.mock.calls[0]?.[0]).toBe(sender.userId);
    // No notification goes with it.
    expect(mockToPerson.mock.calls[0]?.[2]).toEqual([]);

    // Back online: sent, and then nothing waits any more.
    await sendHeldNotices();
    expect(mockToPerson).toHaveBeenCalledTimes(2);
    await sendHeldNotices();
    expect(mockToPerson).toHaveBeenCalledTimes(2);
  });
});

describe('a reaction (docs/ADR/0035 Ek 2)', () => {
  it('shows at once, goes where the item went, to a story its sender alone, the last one counting', async () => {
    const device = generateDeviceKeys(randomUuid());
    useAuth.setState({ userId: ME, device });
    useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
    const sender = { userId: randomUuid(), device: generateDeviceKeys(randomUuid()) };
    const circle: Circle = {
      id: randomUuid(),
      kind: 'family',
      name: 'Aile',
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member',
      myStatus: 'active',
      members: [
        {
          userId: sender.userId,
          role: 'member',
          status: 'active',
          username: null,
          displayName: 'Ali',
          avatar: null,
          device: { platform: 'android', bundle: exportDeviceKeyBundle(sender.device) },
        },
      ],
    };
    mockSenderKeys.set(
      circle.id,
      generateSenderKey({ circleId: circle.id, epoch: 1, senderDeviceId: device.deviceId }),
    );
    queryClient.setQueryData(circlesKey, [circle]);
    const words: ChatItem = {
      id: randomUuid(),
      conversation: `c:${circle.id}`,
      from: sender.userId,
      at: NOW,
      kind: 'text',
      text: 'Geldim',
      state: 'sent',
    };
    const story: ChatItem = {
      id: randomUuid(),
      conversation: `c:${circle.id}`,
      from: sender.userId,
      at: NOW,
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
    };
    useMessages.setState({ ...EMPTY_MESSAGES, loaded: true, items: [words, story] }, true);
    mockToCircle.mockClear();
    mockToPerson.mockClear();
    const reactionsOf = (id: string) =>
      useMessages.getState().items.find((item) => item.id === id)?.reactions;

    // To the circle, as the message went; no notification.
    mockToCircle.mockRejectedValueOnce(new Error('offline'));
    await react(words, '❤️');
    expect(reactionsOf(words.id)).toEqual({ [ME]: '❤️' });
    expect(mockToCircle).toHaveBeenCalledTimes(1);
    expect(mockToCircle.mock.calls[0]?.[0]).toBe(circle.id);
    expect(mockToCircle.mock.calls[0]?.[2]).toEqual([]);
    // Changed while the heart still waits: the heart is dropped, it can never come after.
    await react(words, '😂');
    expect(reactionsOf(words.id)).toEqual({ [ME]: '😂' });
    expect(mockToCircle).toHaveBeenCalledTimes(2);
    await sendHeldNotices();
    expect(mockToCircle).toHaveBeenCalledTimes(2);
    // Taken back.
    await react(words, null);
    expect(reactionsOf(words.id)).toEqual({});

    // To someone's story: to them alone.
    await react(story, '🔥');
    expect(mockToPerson).toHaveBeenCalledTimes(1);
    expect(mockToPerson.mock.calls[0]?.[0]).toBe(sender.userId);
    expect(mockToCircle).toHaveBeenCalledTimes(3);
  });
});
