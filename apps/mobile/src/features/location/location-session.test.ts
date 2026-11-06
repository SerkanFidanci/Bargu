import { startAccountRecorder, stopAccountRecorder } from '../dev/measure/account-recorder';
import { scenarioMetricsSnapshot } from '../dev/measure/scenario';
import { type LocationProbe, probe } from './probe';

const mockLiveRequest = jest.fn<Promise<unknown> | null, [string]>();
const mockReceiveSnapshot = jest.fn<Promise<void>, [unknown[]]>(() => Promise.resolve());
const mockReceiveAll = jest.fn<Promise<void>, [unknown[], string]>(() => Promise.resolve());
const mockReceiverReset = jest.fn(() => undefined);
let mockSignedOut: (() => void) | undefined;

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-battery', () => ({
  getPowerStateAsync: () => Promise.resolve({ batteryLevel: 0.5, batteryState: 1 }),
  BatteryState: { UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
}));
jest.mock('../auth/auth-store', () => ({
  api: { authed: jest.fn() },
  useAuth: { getState: () => ({ userId: null, device: null }) },
  onSignedOut: (listener: () => void) => {
    mockSignedOut = listener;
    return () => {
      mockSignedOut = undefined;
    };
  },
}));
jest.mock('../live/live-session', () => ({
  circleSync: { refresh: jest.fn() },
  keys: jest.fn(),
  liveRequest: (name: string) => mockLiveRequest(name),
  onCirclesGone: jest.fn(),
  onFirstLoad: jest.fn(),
  onLiveMessage: jest.fn(),
  onOnline: jest.fn(),
  onPeopleDeparted: jest.fn(),
  onServerEvents: jest.fn(),
}));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => false, vault: jest.fn() }));
jest.mock('../circles/circle-sync', () => ({ useCircleKeys: { subscribe: jest.fn() } }));
jest.mock('../checkin/checkin-session', () => ({
  checkinFix: jest.fn(),
  checkinLowBattery: jest.fn(),
  wantsLocation: jest.fn(),
}));
jest.mock('../history/history', () => ({
  createHistory: () => ({
    fix: jest.fn(),
    flush: jest.fn(),
    forget: jest.fn(),
    forgetMine: jest.fn(),
    reset: jest.fn(),
    sharingChanged: jest.fn(),
  }),
}));
jest.mock('../history/history-api', () => ({
  historyApi: {},
  removeAllHistory: jest.fn(),
  useHistoryPings: { setState: jest.fn() },
}));
jest.mock('../history/viewer-notice', () => ({ tellNewViewer: jest.fn() }));
jest.mock('../history/own/own-flag', () => ({ OWN_HISTORY_ENABLED: false }));
jest.mock('../history/own/own-session', () => ({
  ownEntitled: jest.fn(),
  ownTrail: { record: jest.fn() },
}));
jest.mock('../cosmetics/look-session', () => ({ receivedLook: jest.fn() }));
jest.mock('../profile/photo', () => ({
  publishProfile: jest.fn(),
  receivedProfile: jest.fn(),
  resetPhotos: jest.fn(),
  restorePhotos: jest.fn(),
}));
jest.mock('../places/presence', () => ({
  createPresence: () => ({ fix: jest.fn() }),
  placeEvent: jest.fn(),
}));
jest.mock('../plan/meeting', () => ({
  createMeetings: () => ({ eta: jest.fn(), fix: jest.fn(), forget: jest.fn(), reset: jest.fn() }),
  useArrived: { setState: jest.fn() },
  useLates: { setState: jest.fn() },
  arrivedEvent: jest.fn(),
  lateEvent: jest.fn(),
}));
jest.mock('../plan/reminders', () => ({
  cancelAllReminders: jest.fn(() => Promise.resolve()),
  cancelReminder: jest.fn(),
  remindToLeave: jest.fn(),
}));
jest.mock('../social/safe-session', () => ({
  receivedSafe: jest.fn(),
  restoreSafe: jest.fn(),
  safeCheckIns: { flush: jest.fn() },
}));
jest.mock('../notifications/extension-share', () => ({
  shareHistoryWithExtension: jest.fn(),
  shareLiveWithExtension: jest.fn(),
}));
jest.mock('./sharing-reminder-notification', () => ({
  cancelSharingReminder: jest.fn(() => Promise.resolve()),
  scheduleSharingReminder: jest.fn(),
}));
jest.mock('./engine', () => ({
  createLocationEngine: () => ({
    active: jest.fn(),
    audience: jest.fn(() => []),
    changed: jest.fn(),
    flush: jest.fn(),
    holding: jest.fn(),
    reset: jest.fn(),
    watched: jest.fn(),
  }),
  LIVE_MS: 120_000,
  toSendCircle: jest.fn(),
  useMyFix: { getState: () => ({ fix: null }), setState: jest.fn() },
}));
jest.mock('./state-report', () => ({
  createStateReporter: () => ({
    changed: jest.fn(),
    flush: jest.fn(),
    reset: jest.fn(),
    sampled: jest.fn(),
  }),
}));
jest.mock('./tracker', () => ({ stopTracking: jest.fn(() => Promise.resolve()) }));
jest.mock('./forget-person', () => ({ forgetDeparted: () => jest.fn() }));
jest.mock('./receive', () => ({
  createReceiver: () => ({
    gone: jest.fn(),
    prune: jest.fn(),
    receive: jest.fn(),
    receiveAll: (envelopes: unknown[], route: string) => mockReceiveAll(envelopes, route),
    receiveSnapshot: (envelopes: unknown[]) => mockReceiveSnapshot(envelopes),
    reset: () => {
      mockReceiverReset();
    },
    restore: jest.fn(),
    retryWaiting: jest.fn(),
    stateGone: jest.fn(),
  }),
}));

import { syncLocationSnapshots } from './location-session';

function listener(events: {
  spans: string[];
  counts: [string, number | undefined][];
  maximums: [string, number][];
}): LocationProbe {
  return {
    sampled: () => undefined,
    sent: () => undefined,
    received: () => undefined,
    span: (name) => events.spans.push(name),
    backgroundLive: () => undefined,
    count: (name, delta) => events.counts.push([name, delta]),
    max: (name, value) => events.maximums.push([name, value]),
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

beforeEach(() => {
  mockLiveRequest.mockReset();
  mockReceiveSnapshot.mockReset().mockResolvedValue();
  mockReceiveAll.mockReset().mockResolvedValue();
  mockReceiverReset.mockClear();
  stopAccountRecorder();
  probe.current = null;
});

afterEach(() => {
  stopAccountRecorder();
  probe.current = null;
});

describe('location snapshot measurement', () => {
  it('keeps five routes sequential, counts each apply, and has inflight baseline one', async () => {
    const calls: string[] = [];
    mockLiveRequest.mockImplementation((name) => {
      calls.push(`request:${name}`);
      return Promise.resolve({ envelopes: [] });
    });
    mockReceiveSnapshot.mockImplementation(() => {
      calls.push('apply:locations');
      return Promise.resolve();
    });
    mockReceiveAll.mockImplementation((_envelopes, route) => {
      calls.push(`apply:${route}`);
      return Promise.resolve();
    });
    const events = {
      spans: [] as string[],
      counts: [] as [string, number | undefined][],
      maximums: [] as [string, number][],
    };
    probe.current = listener(events);

    await syncLocationSnapshots();
    expect(calls).toEqual([
      'request:locations',
      'apply:locations',
      'request:statuses',
      'apply:status',
      'request:profiles',
      'apply:profile',
      'request:looks',
      'apply:look',
      'request:states',
      'apply:state',
    ]);
    expect(events.spans).toEqual([
      'location.snapshot.fetch',
      'location.snapshot.apply',
      'location.snapshot.fetch',
      'location.snapshot.apply',
      'location.snapshot.fetch',
      'location.snapshot.apply',
      'location.snapshot.fetch',
      'location.snapshot.apply',
      'location.snapshot.fetch',
      'location.snapshot.apply',
    ]);
    expect(events.counts.map(([name]) => name)).toEqual([
      'snapshot.locations',
      'snapshot.statuses',
      'snapshot.profiles',
      'snapshot.looks',
      'snapshot.states',
    ]);
    expect(events.maximums).toEqual([
      ['snapshot.inflight', 1],
      ['snapshot.inflight', 1],
      ['snapshot.inflight', 1],
      ['snapshot.inflight', 1],
      ['snapshot.inflight', 1],
    ]);
  });

  it('stops after a route error, decrements inflight, and resumes at baseline one', async () => {
    const maximums: [string, number][] = [];
    const counts: [string, number | undefined][] = [];
    const spans: string[] = [];
    probe.current = listener({ spans, counts, maximums });
    mockLiveRequest.mockImplementation((name) =>
      name === 'statuses'
        ? Promise.reject(new Error('offline'))
        : Promise.resolve({ envelopes: [] }),
    );
    await expect(syncLocationSnapshots()).rejects.toThrow('offline');
    expect(mockLiveRequest.mock.calls.map(([name]) => name)).toEqual(['locations', 'statuses']);
    expect(counts.map(([name]) => name)).toEqual(['snapshot.locations']);
    expect(maximums).toEqual([
      ['snapshot.inflight', 1],
      ['snapshot.inflight', 1],
    ]);

    maximums.length = 0;
    mockLiveRequest.mockImplementation(() => Promise.resolve({ envelopes: [] }));
    await syncLocationSnapshots();
    expect(maximums.at(-1)).toEqual(['snapshot.inflight', 1]);
  });

  it('keeps the existing signout reset while a deferred apply is pending', async () => {
    const applying = deferred<undefined>();
    mockLiveRequest.mockImplementation(() => Promise.resolve({ envelopes: [] }));
    mockReceiveSnapshot.mockReturnValueOnce(applying.promise);
    const syncing = syncLocationSnapshots();
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(mockReceiveSnapshot).toHaveBeenCalledTimes(1);
    mockSignedOut?.();
    expect(mockReceiverReset).toHaveBeenCalledTimes(1);
    applying.resolve(undefined);
    await syncing;
    expect(mockReceiverReset).toHaveBeenCalledTimes(1);
  });

  it('does not write deferred account A route metrics after account B starts', async () => {
    const fetching = deferred<{ envelopes: never[] }>();
    mockLiveRequest
      .mockImplementationOnce(() => fetching.promise)
      .mockImplementation(() => Promise.resolve({ envelopes: [] }));
    startAccountRecorder('account-a');
    const syncing = syncLocationSnapshots();

    stopAccountRecorder();
    const b = startAccountRecorder('account-b');
    fetching.resolve({ envelopes: [] });
    await syncing;

    expect(scenarioMetricsSnapshot().counters['snapshot.locations']).toBe(0);
    expect(scenarioMetricsSnapshot().counters['snapshot.statuses']).toBe(0);
    expect(scenarioMetricsSnapshot().maximums['snapshot.inflight']).toBe(0);
    expect(scenarioMetricsSnapshot().spans).toEqual({});

    b.listener.count?.('snapshot.states');
    expect(scenarioMetricsSnapshot().counters['snapshot.states']).toBe(1);
  });
});
