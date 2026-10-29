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

// Off, as the switch that keeps it from a build (on since package G): nothing of it then.
jest.mock('./own-flag', () => ({ OWN_HISTORY_ENABLED: false }));

import { OWN_HISTORY_ENABLED } from './own-flag';
import { ownEntitled, ownTrailForExport, ownTrailTick, rememberEntitlement } from './own-session';

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

describe('switched off (the PM, 2026-10-29: Ö7 hidden and off until it is turned on)', () => {
  it('is off here', () => {
    expect(OWN_HISTORY_ENABLED).toBe(false);
  });

  it('makes no key and no file, remembers no plan for it, and exports nothing', async () => {
    rememberEntitlement(plan({ plan: 'plus', expiresAt: NOW + DAY }));
    expect(mockVault.size).toBe(0);
    expect(ownEntitled(NOW)).toBe(false);
    await ownTrailTick(NOW);
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockMonths.size).toBe(0);
    expect(await ownTrailForExport()).toEqual([]);
    expect(mockPrepare).not.toHaveBeenCalled();
  });
});
