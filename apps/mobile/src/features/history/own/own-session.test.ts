import type { Plan } from '@bargu/schemas';

import type { KeyValueStore } from '../../storage/vault';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
// The auth store loads the secure store; its native module is not there on Linux (CI).
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 2,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));

const mockVault = new Map<string, string>();
const store: KeyValueStore = {
  get: (key) => mockVault.get(key),
  set: (key, value) => {
    mockVault.set(key, value);
  },
  delete: (key) => {
    mockVault.delete(key);
  },
  keys: () => [...mockVault.keys()],
  clear: () => {
    mockVault.clear();
  },
};
const mockOpen = { current: true };
jest.mock('../../storage/vault', () => ({
  isVaultOpen: () => mockOpen.current,
  vault: () => store,
}));

// The month files are native (own-trail.test.ts has them in memory): here a key that can be read or
// not, and a file that counts.
const mockKey = { ready: false };
const mockDestroyed = jest.fn();
const mockPrepare = jest.fn((create: boolean) => {
  if (mockKey.ready) return Promise.resolve(true);
  return Promise.resolve(create ? (mockKey.ready = true) : false);
});
const mockMonths = new Map<string, Map<string, string>>();
jest.mock('./own-files', () => ({
  createMonthFiles: () => ({
    months: () => [...mockMonths.keys()],
    open: (month: string) => {
      const data = mockMonths.get(month) ?? new Map<string, string>();
      mockMonths.set(month, data);
      return {
        store: {
          get: (key: string) => data.get(key),
          set: (key: string, value: string) => {
            data.set(key, value);
          },
          delete: (key: string) => {
            data.delete(key);
          },
          keys: () => [...data.keys()],
          clear: () => {
            data.clear();
          },
        },
        close: () => undefined,
      };
    },
    destroy: () => {
      mockMonths.clear();
      mockDestroyed();
    },
  }),
  forgetTrailKey: () => {
    mockKey.ready = false;
  },
  prepareTrailKey: (create: boolean) => mockPrepare(create),
  trailKeyReady: () => mockKey.ready,
}));

// What it does once package D turns it on (own-off.test.ts: what it does before).
jest.mock('./own-flag', () => ({ OWN_HISTORY_ENABLED: true }));

import { ownEntitled, ownTrail, ownTrailTick, rememberEntitlement } from './own-session';

const NOW = new Date(2026, 9, 29, 12, 0).getTime();
const DAY = 24 * 3_600_000;
const plan = (overrides: Partial<Plan>): Plan => ({
  plan: 'free',
  product: null,
  source: null,
  expiresAt: null,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: null,
  cosmetics: [],
  testBilling: false,
  ...overrides,
});

beforeEach(() => {
  mockVault.clear();
  mockMonths.clear();
  mockKey.ready = false;
  mockOpen.current = true;
  jest.clearAllMocks();
});

describe('the plan the recording asks for (docs/ADR/0030 §5)', () => {
  it('is Bargu+ or its trial, until the plan ends; free, unknown or a closed vault is not', () => {
    expect(ownEntitled(NOW)).toBe(false);
    rememberEntitlement(plan({ plan: 'plus', expiresAt: NOW + DAY }));
    expect(ownEntitled(NOW)).toBe(true);
    expect(ownEntitled(NOW + 2 * DAY)).toBe(false);
    // A payment that failed holds the plan until its grace ends.
    rememberEntitlement(plan({ plan: 'plus', expiresAt: NOW - DAY, graceUntil: NOW + DAY }));
    expect(ownEntitled(NOW)).toBe(true);
    rememberEntitlement(plan({ plan: 'trial', trialEndsAt: NOW + 3 * DAY }));
    expect(ownEntitled(NOW)).toBe(true);
    rememberEntitlement(plan({ plan: 'free' }));
    expect(ownEntitled(NOW)).toBe(false);
    rememberEntitlement(plan({ plan: 'plus', expiresAt: NOW + DAY }));
    mockOpen.current = false;
    expect(ownEntitled(NOW)).toBe(false);
  });

  it('is never expiring for a plan with no end', () => {
    rememberEntitlement(plan({ plan: 'plus', expiresAt: null }));
    expect(ownEntitled(NOW + 400 * DAY)).toBe(true);
  });
});

describe('the turn that keeps it tidy', () => {
  it('does nothing while off and empty, reads the key once turned on, then compacts finished days', async () => {
    await ownTrailTick(NOW);
    expect(mockPrepare).not.toHaveBeenCalled();

    ownTrail.setSettings({ on: true, keep: 30 });
    const yesterday = NOW - DAY;
    for (let step = 0; step < 7; step++) {
      ownTrail.record(
        { lat: 41.0256, lng: 28.9742, acc: 10, ts: yesterday + step * 5 * 60_000 },
        { entitled: true, ghost: 'off', sharing: true },
      );
    }
    await ownTrailTick(NOW);
    expect(mockPrepare).toHaveBeenCalledWith(true);
    expect(mockMonths.size).toBe(1);
    expect(ownTrail.days()).toHaveLength(1);
  });

  it('waits with the phone locked: the key cannot be read, nothing is written to the files', async () => {
    ownTrail.setSettings({ on: true, keep: 30 });
    mockPrepare.mockResolvedValueOnce(false);
    ownTrail.record(
      { lat: 41.0256, lng: 28.9742, acc: 10, ts: NOW - DAY },
      { entitled: true, ghost: 'off', sharing: true },
    );
    await ownTrailTick(NOW);
    expect(mockMonths.size).toBe(0);
    expect(ownTrail.days()).toHaveLength(1);
  });

  it('forgets old days once a day, not at every turn', async () => {
    ownTrail.setSettings({ on: true, keep: 30 });
    mockKey.ready = true;
    const prune = jest.spyOn(ownTrail, 'prune');
    await ownTrailTick(NOW);
    await ownTrailTick(NOW + 60_000);
    expect(prune).toHaveBeenCalledTimes(1);
    await ownTrailTick(NOW + DAY + 60_000);
    expect(prune).toHaveBeenCalledTimes(2);
  });
});
