import { createDeviceKeys, deleteDeviceKeys, loadDeviceKeys } from './device-key-store';

const mockItems = new Map<string, string>();
const mockCalls: unknown[] = [];

jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 'afterFirstUnlockThisDeviceOnly',
  getItemAsync: (key: string, options: unknown) => {
    mockCalls.push(options);
    return Promise.resolve(mockItems.get(key) ?? null);
  },
  setItemAsync: (key: string, value: string, options: unknown) => {
    mockCalls.push(options);
    mockItems.set(key, value);
    return Promise.resolve();
  },
  deleteItemAsync: (key: string) => {
    mockItems.delete(key);
    return Promise.resolve();
  },
}));

describe('device key store', () => {
  beforeEach(() => {
    mockItems.clear();
    mockCalls.length = 0;
  });

  it('stores only the two secrets and restores the same identity', async () => {
    expect(await loadDeviceKeys()).toBeNull();
    const created = await createDeviceKeys();
    const stored = JSON.parse([...mockItems.values()][0] ?? '{}') as Record<string, string>;
    expect(Object.keys(stored).sort()).toEqual(['deviceId', 'dhSecretKey', 'identitySecretKey']);

    const loaded = await loadDeviceKeys();
    expect(loaded?.deviceId).toBe(created.deviceId);
    expect(loaded?.identity.publicKey).toEqual(created.identity.publicKey);
    expect(loaded?.dhKeySignature).toEqual(created.dhKeySignature);
    // Never synced, readable after the first unlock (background work while locked).
    expect(mockCalls).toContainEqual({ keychainAccessible: 'afterFirstUnlockThisDeviceOnly' });
  });

  it('creates a new device id every time and forgets keys on delete', async () => {
    const first = await createDeviceKeys();
    const second = await createDeviceKeys();
    expect(second.deviceId).not.toBe(first.deviceId);
    await deleteDeviceKeys();
    expect(await loadDeviceKeys()).toBeNull();
  });

  it('refuses a corrupted entry instead of guessing', async () => {
    mockItems.set('bargu.device.v1', JSON.stringify({ deviceId: 'x' }));
    await expect(loadDeviceKeys()).rejects.toThrow();
  });
});
