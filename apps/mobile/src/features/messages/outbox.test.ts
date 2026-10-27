import { generateDeviceKeys, generateSenderKey, randomUuid, type SenderKey } from '@bargu/crypto';
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
jest.mock('./messages-api', () => ({
  messagesApi: {
    upload: (blobId: string, sealed: Uint8Array) => mockUpload(blobId, sealed),
    toCircle: (circleId: string, envelope: unknown, pushes: unknown, blobId?: string) =>
      mockToCircle(circleId, envelope, pushes, blobId),
  },
}));

import { useAuth } from '../auth/auth-store';
import { circlesKey } from '../circles/circle-cache';
import { queryClient } from '../query-client';
import { EMPTY_MESSAGES, useMessages } from './messages';
import { pushOf, shareStory } from './outbox';
import { sealPhoto } from './photo';

const ME = randomUuid();
const NOW = 1_800_000_000_000;

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
    expect(
      pushOf({ kind: 'shot', id: randomUuid(), target: randomUuid(), ts: NOW }, undefined),
    ).toEqual({ kind: 'shot', ts: NOW });
    expect(
      pushOf({ kind: 'del', id: randomUuid(), target: randomUuid(), ts: NOW }, circleId),
    ).toBeNull();
  });
});

describe('a story', () => {
  it('uploads its file once and sends an item of its own to each circle', async () => {
    const device = generateDeviceKeys(randomUuid());
    useAuth.setState({ userId: ME, device });
    useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
    const circle = (name: string): Circle => ({
      id: randomUuid(),
      kind: 'family',
      name,
      epoch: 1,
      epochStartedAt: 0,
      myRole: 'member',
      myStatus: 'active',
      members: [],
    });
    const circles = [circle('Aile'), circle('Okul')];
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
    ).resolves.toBe('sent');

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
  });
});
