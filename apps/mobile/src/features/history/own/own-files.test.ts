import type { KeyValueStore } from '../../storage/vault';

const mockSecure = new Map<string, string>();
const mockLocked = { current: false };
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'when-unlocked-this-device-only',
  getItemAsync: (name: string) =>
    mockLocked.current
      ? Promise.reject(new Error('locked'))
      : Promise.resolve(mockSecure.get(name) ?? null),
  setItemAsync: (name: string, value: string) => {
    mockSecure.set(name, value);
    return Promise.resolve();
  },
  deleteItemAsync: (name: string) => {
    mockSecure.delete(name);
    return Promise.resolve();
  },
}));
const mockDeleted: string[] = [];
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: () => undefined,
    set: () => undefined,
    remove: () => undefined,
    getAllKeys: () => [],
    clearAll: () => undefined,
    trim: () => undefined,
  }),
  deleteMMKV: (id: string) => {
    mockDeleted.push(id);
    return true;
  },
}));
jest.mock('@bargu/crypto', () => ({ generateToken: () => 'n'.repeat(43) }));

import {
  createMonthFiles,
  forgetTrailKey,
  prepareTrailKey,
  takeKeyLost,
  trailKeyReady,
} from './own-files';

const data = new Map<string, string>();
const vault: KeyValueStore = {
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
const MONTHS = 'own:months:v1';
const KEY = 'bargu.trail.v1';

createMonthFiles(() => vault);

beforeEach(() => {
  data.clear();
  mockSecure.clear();
  mockDeleted.length = 0;
  mockLocked.current = false;
  forgetTrailKey();
});

describe('a lost key of one own history (QA-43)', () => {
  it('deletes the month files it can no longer read, then starts again with a new key', async () => {
    data.set(MONTHS, JSON.stringify(['2026-09', '2026-10']));
    expect(await prepareTrailKey(true)).toBe(true);
    expect(mockDeleted).toEqual(
      expect.arrayContaining(['bargu-trail-2026-09', 'bargu-trail-2026-10']),
    );
    expect(data.has(MONTHS)).toBe(false);
    expect(mockSecure.get(KEY)).toHaveLength(32);
    // Said once, not again.
    expect(takeKeyLost(vault)).toBe(true);
    expect(takeKeyLost(vault)).toBe(false);
  });

  it('deletes them too when the history is off, and makes no key then', async () => {
    data.set(MONTHS, JSON.stringify(['2026-10']));
    expect(await prepareTrailKey(false)).toBe(false);
    expect(mockDeleted).toContain('bargu-trail-2026-10');
    expect(mockSecure.has(KEY)).toBe(false);
    expect(takeKeyLost(vault)).toBe(true);
  });

  it('touches nothing when the key is there', async () => {
    mockSecure.set(KEY, 'k'.repeat(32));
    data.set(MONTHS, JSON.stringify(['2026-10']));
    expect(await prepareTrailKey(false)).toBe(true);
    expect(trailKeyReady()).toBe(true);
    expect(mockDeleted).toEqual([]);
    expect(takeKeyLost(vault)).toBe(false);
  });

  it('touches nothing when the phone is only locked', async () => {
    mockLocked.current = true;
    data.set(MONTHS, JSON.stringify(['2026-10']));
    expect(await prepareTrailKey(true)).toBe(false);
    expect(mockDeleted).toEqual([]);
    expect(data.has(MONTHS)).toBe(true);
    expect(takeKeyLost(vault)).toBe(false);
  });

  it('says nothing the first time the history is turned on (no files yet)', async () => {
    expect(await prepareTrailKey(true)).toBe(true);
    expect(mockDeleted).toEqual([]);
    expect(takeKeyLost(vault)).toBe(false);
  });
});
