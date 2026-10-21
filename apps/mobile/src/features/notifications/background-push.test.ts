import { generateDeviceKeys, randomUuid, sealForDevice, sealPush } from '@bargu/crypto';
import type { PushBody } from '@bargu/schemas';
import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { toast } from '@/ui/toast';

import { backgroundLive } from '../location/background-live/slot';
import { memoryStore } from '../location/test-support';
import { PUSH_FRESH_MS, showPush, WATCH_FRESH_MS } from './background-push';

const mockDevice = generateDeviceKeys(randomUuid());
const mockStore = memoryStore();

// Native modules jest does not have on Linux (CI), though Windows resolves them.
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('id')),
  registerTaskAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn(),
  isTaskRegisteredAsync: jest.fn(() => Promise.resolve(true)),
}));
jest.mock('@/ui/toast', () => ({ toast: { info: jest.fn() } }));
jest.mock('../auth/auth-store', () => ({
  useAuth: { getState: () => ({ device: mockDevice }) },
}));
jest.mock('../live/live-session', () => ({ ensureSession: () => Promise.resolve(true) }));
jest.mock('../storage/vault', () => ({ vault: () => mockStore }));

const circleId = randomUuid();
const NOW = 1_800_000_000_000;
const recipient = { deviceId: mockDevice.deviceId, dhKey: mockDevice.dh.publicKey };
const notice = (kind: string, ts = NOW) => ({ kind: 'notice', notice: kind, circleId, ts });

/** A box the server sealed for this phone. */
const fromServer = (body: PushBody) => sealPush({ recipient, sender: null, body });

/**
 * A box with a body this app's schema does not know, the way a newer server would send one to an
 * older app (sealPush itself refuses to seal it).
 */
function fromNewerServer(body: unknown): string {
  const json = new TextEncoder().encode(JSON.stringify(body));
  const inner = new Uint8Array(json.length + 1);
  inner.set(json, 1);
  return sealForDevice(mockDevice.dh.publicKey, inner);
}

const scheduled = Notifications.scheduleNotificationAsync as jest.Mock;
const toasted = toast.info as jest.Mock;
const mockNotice = jest.fn<Promise<void>, [string]>(() => Promise.resolve());

function appIs(state: 'active' | 'background') {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStore.clear();
  backgroundLive.current = { notice: (id) => mockNotice(id) };
  backgroundLive.loading = null;
  appIs('background');
});
afterEach(() => {
  backgroundLive.current = null;
});

describe('a notice this app does not know is dropped silently', () => {
  it('shows nothing, whether the app is closed or open, and does not touch background live mode', async () => {
    for (const state of ['background', 'active'] as const) {
      appIs(state);
      const sealed = fromNewerServer(notice('someFutureNews'));
      expect(await showPush(sealed, NOW)).toBe('refused');
    }
    // A whole new kind of notification, too.
    expect(await showPush(fromNewerServer({ kind: 'hologram', circleId, ts: NOW }), NOW)).toBe(
      'refused',
    );
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
    expect(mockNotice).not.toHaveBeenCalled();
  });
});

describe('the watch notice of background live mode (docs/ADR/0028 step 3)', () => {
  const watch = (ts = NOW) => fromServer({ kind: 'notice', notice: 'watch', circleId, ts });

  it('is never shown: no notification in the background, no line in the open app', async () => {
    expect(await showPush(watch(), NOW)).toBe('watch');
    appIs('active');
    expect(await showPush(watch(), NOW)).toBe('watch');
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
  });

  it('goes to background live mode with the circle it names, nothing else', async () => {
    await showPush(watch(), NOW);
    expect(mockNotice).toHaveBeenCalledTimes(1);
    expect(mockNotice).toHaveBeenCalledWith(circleId);
  });

  it('waits for the feature to load when the app was started by the notice', async () => {
    backgroundLive.current = null;
    let loaded = false;
    backgroundLive.loading = Promise.resolve().then(() => {
      backgroundLive.current = {
        notice: (id) => {
          loaded = true;
          return mockNotice(id);
        },
      };
    });
    await showPush(watch(), NOW);
    expect(loaded).toBe(true);
  });

  it('is dropped without a trace in a build that does not have the feature (production)', async () => {
    backgroundLive.current = null;
    expect(await showPush(watch(), NOW)).toBe('watch');
    expect(scheduled).not.toHaveBeenCalled();
    expect(toasted).not.toHaveBeenCalled();
  });

  it('is old after two minutes, and a message delivered twice counts once', async () => {
    expect(WATCH_FRESH_MS).toBe(2 * 60_000);
    expect(await showPush(watch(NOW - WATCH_FRESH_MS - 1), NOW)).toBe('stale');
    expect(mockNotice).not.toHaveBeenCalled();
    const once = watch();
    expect(await showPush(once, NOW)).toBe('watch');
    expect(await showPush(once, NOW)).toBe('duplicate');
    expect(mockNotice).toHaveBeenCalledTimes(1);
  });

  it('leaves the freshness of every other notification as it was (an hour)', async () => {
    const invite = fromServer({
      kind: 'notice',
      notice: 'circleInvite',
      circleId,
      ts: NOW - 10 * 60_000,
    });
    expect(await showPush(invite, NOW)).toBe('shown');
    expect(scheduled).toHaveBeenCalledTimes(1);
    const old = fromServer({
      kind: 'notice',
      notice: 'circleInvite',
      circleId,
      ts: NOW - PUSH_FRESH_MS - 1,
    });
    expect(await showPush(old, NOW)).toBe('stale');
  });
});
