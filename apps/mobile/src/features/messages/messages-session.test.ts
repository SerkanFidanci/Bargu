import { exportDeviceKeyBundle, randomUuid, sealDirect } from '@bargu/crypto';
import type { ChatRecord } from '@bargu/schemas';

import { circlesKey } from '../circles/circle-cache';
import { startAccountRecorder, stopAccountRecorder } from '../dev/measure/account-recorder';
import { scenarioMetricsSnapshot } from '../dev/measure/scenario';
import { verifiedBundle } from '../keys/bundle-cache';
import { type LocationProbe, probe } from '../location/probe';
import { circleOf, exchangeKeys, type Person, somebody } from '../location/test-support';
import { queryClient } from '../query-client';
import { EMPTY_MESSAGES, useMessages } from './messages';

let mockPhone: Person;
const mockSince = jest.fn<Promise<ChatRecord[]>, [number]>();
jest.mock('./messages-api', () => ({
  messagesApi: { since: (since: number) => mockSince(since) },
}));
jest.mock('../auth/auth-store', () => ({
  useAuth: { getState: () => ({ userId: mockPhone.userId, device: mockPhone.device }) },
  onSignedOut: jest.fn(),
}));
jest.mock('../live/live-session', () => ({
  keys: () => mockPhone.keys,
  onCirclesGone: jest.fn(),
  onLiveMessage: jest.fn(),
  onOnline: jest.fn(),
  onPeopleDeparted: jest.fn(),
}));
jest.mock('../storage/vault', () => ({
  isVaultOpen: () => true,
  vault: () => mockPhone.store,
}));
jest.mock('./outbox', () => ({ sendHeldNotices: jest.fn() }));
jest.mock('./photo', () => ({ forgetPhotoFiles: jest.fn(), sweepPictureFiles: jest.fn() }));

import { catchUp } from './messages-session';

beforeEach(() => {
  jest.useFakeTimers({ now: new Date(2026, 10, 6, 12, 0) });
  mockPhone = somebody();
  mockSince.mockReset();
  useMessages.setState({ ...EMPTY_MESSAGES, loaded: true }, true);
});

afterEach(() => {
  stopAccountRecorder();
  probe.current = null;
  queryClient.clear();
  jest.useRealTimers();
});

describe('messages catch-up measurement', () => {
  it('times the total catch-up and counts incoming records with the same ingest result', async () => {
    const sender = somebody();
    const circle = circleOf([mockPhone, sender]);
    exchangeKeys(circle, [mockPhone, sender]);
    queryClient.setQueryData(circlesKey, [circle]);
    const record: ChatRecord = {
      id: randomUuid(),
      senderId: sender.userId,
      circleId: null,
      recipientId: mockPhone.userId,
      envelope: sealDirect({
        sender: sender.device,
        recipient: verifiedBundle(exportDeviceKeyBundle(mockPhone.device)),
        payload: { kind: 'text', id: randomUuid(), text: 'selam', ts: Date.now() - 1_000 },
      }),
      blobId: null,
      at: Date.now() - 500,
    };
    mockSince.mockResolvedValue([record]);
    const spans: string[] = [];
    const counts: [string, number | undefined][] = [];
    const listener: LocationProbe = {
      sampled: () => undefined,
      sent: () => undefined,
      received: () => undefined,
      span: (name) => spans.push(name),
      backgroundLive: () => undefined,
      count: (name, delta) => counts.push([name, delta]),
    };
    probe.current = listener;

    await catchUp();
    expect(spans).toEqual(['messages.inbox.total']);
    expect(counts).toEqual([
      ['messages.inbox.records', 1],
      ['messages.inbox.records', 0],
    ]);
    expect(useMessages.getState().items.map((item) => item.text)).toEqual(['selam']);
    expect(mockSince).toHaveBeenCalledTimes(1);
  });

  it('does not write deferred account A catch-up metrics after account B starts', async () => {
    let resolve!: (records: ChatRecord[]) => void;
    const answer = new Promise<ChatRecord[]>((yes) => {
      resolve = yes;
    });
    mockSince.mockReturnValue(answer);
    startAccountRecorder('account-a');
    const catchingUp = catchUp();

    stopAccountRecorder();
    const b = startAccountRecorder('account-b');
    resolve([]);
    await catchingUp;

    expect(scenarioMetricsSnapshot().counters['messages.inbox.records']).toBe(0);
    expect(scenarioMetricsSnapshot().spans).toEqual({});

    b.listener.count?.('messages.inbox.records', 2);
    expect(scenarioMetricsSnapshot().counters['messages.inbox.records']).toBe(2);
  });
});
