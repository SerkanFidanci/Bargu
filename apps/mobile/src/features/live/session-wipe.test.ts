import { exportDeviceKeyBundle, generateDeviceKeys, randomUuid } from '@bargu/crypto';
import type { Circle, Session } from '@bargu/schemas';

// The secure store (the vault's key lives here, with the device keys).
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecure.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecure.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockSecure.delete(key);
    return Promise.resolve();
  }),
}));
// The vault's file, by id: it outlives the open handle, as the real one does, so that what is not
// deleted would still be found by the next open.
const mockFiles = new Map<string, Map<string, string>>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: ({ id }: { id: string }) => {
    const data = mockFiles.get(id) ?? new Map<string, string>();
    mockFiles.set(id, data);
    return {
      getString: (key: string) => data.get(key),
      set: (key: string, value: string) => data.set(key, value),
      remove: (key: string) => data.delete(key),
      getAllKeys: () => [...data.keys()],
      clearAll: () => {
        data.clear();
      },
    };
  },
}));
jest.mock('@react-native-community/netinfo', () => ({
  addEventListener: jest.fn(() => jest.fn()),
}));
// Native modules that only exist on a phone (the test does not use them; the app imports them).
jest.mock('expo-router', () => ({ router: { push: jest.fn(), replace: jest.fn() } }));
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: jest.fn(),
  isEnrolledAsync: jest.fn(),
  authenticateAsync: jest.fn(),
}));
jest.mock('../notifications/extension-share', () => ({
  shareMutesWithExtension: () => Promise.resolve(),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));

import { deleteAccount } from '../account/account-api';
import { api, bootstrapAuth, requestCode, signOut, useAuth, verifyCode } from '../auth/auth-store';
import { updateMutes } from '../notifications/mute-session';
import { useMutes, withPersonMuted } from '../notifications/mutes';
import { destroyVault, isVaultOpen, openVault, vault } from '../storage/vault';
import { keys } from './live-session';

type Handler = (path: string, init: RequestInit) => { status: number; body?: unknown };
let handler: Handler = () => ({ status: 500 });

globalThis.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
  const path = (url instanceof Request ? url.url : url.toString()).replace('https://api.test', '');
  const { status, body } = handler(path, init ?? {});
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as typeof fetch;

function session(deviceId: string): Session {
  return {
    userId: randomUuid(),
    deviceId,
    accessToken: 'access',
    accessTokenExpiresAt: Date.now() + 600_000,
    refreshToken: 'refresh',
    refreshTokenExpiresAt: Date.now() + 86_400_000,
    isNewUser: true,
  };
}

async function signedIn(): Promise<void> {
  const challengeId = randomUuid();
  handler = (path, init) =>
    path === '/v1/auth/otp/request'
      ? { status: 202, body: { challengeId, expiresIn: 600 } }
      : {
          status: 200,
          body: session(
            (
              JSON.parse(typeof init.body === 'string' ? init.body : '{}') as {
                device: { bundle: { deviceId: string } };
              }
            ).device.bundle.deviceId,
          ),
        };
  await bootstrapAuth();
  await requestCode('ayse@example.test');
  await verifyCode(challengeId, '12345678');
}

beforeEach(async () => {
  // A vault left open by the test before (the check at its end opens one again) is closed.
  await destroyVault();
  mockSecure.clear();
  mockFiles.clear();
  useAuth.setState({ status: 'loading', device: null, userId: null });
});

// The trust records (a public identity key per person met) and the user's mutes (a user id and two
// flags) are in the vault, and they stay there when a person is forgotten (features/location/
// forget-person.ts). They go with the account: the vault is wiped whole when a session ends,
// however it ends.
describe('what a session leaves behind on the phone', () => {
  const ends: [string, () => Promise<void>][] = [
    ['sign-out', () => signOut()],
    [
      'account deletion (deleted on the server, then signed out)',
      async () => {
        handler = () => ({ status: 200, body: {} });
        await deleteAccount();
        await signOut();
      },
    ],
    [
      'a session the server ended',
      async () => {
        handler = (path) =>
          path === '/v1/auth/refresh'
            ? { status: 401, body: { statusCode: 401, error: 'x', code: 'DEVICE_REVOKED' } }
            : { status: 401, body: { statusCode: 401, error: 'x', code: 'TOKEN_EXPIRED' } };
        await expect(api.authed('/v1/me')).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
      },
    ],
  ];

  it.each(ends)(
    'after %s the trust records, and the vault with them, are gone',
    async (_name, end) => {
      await signedIn();
      await openVault();
      const store = keys();
      const bob = generateDeviceKeys(randomUuid());
      const circle: Circle = {
        id: randomUuid(),
        kind: 'pair',
        name: null,
        epoch: 1,
        epochStartedAt: Date.now(),
        myRole: 'owner',
        myStatus: 'active',
        members: [
          {
            userId: randomUuid(),
            role: 'member',
            status: 'active',
            username: null,
            displayName: 'Bob',
            avatar: null,
            device: { platform: 'android', bundle: exportDeviceKeyBundle(bob) },
          },
        ],
      };
      const bobId = circle.members[0]?.userId ?? '';
      store.observe(circle);
      store.rememberPeople({ [bobId]: [bob.deviceId] });
      // The user muted him, and later no circle is shared with him: that mute is kept (the user's
      // own protection), but only until the session ends.
      updateMutes((current) => withPersonMuted(current, bobId, { pokes: true }));
      const trusted = vault().keys();
      expect(trusted.some((key) => key.startsWith('identity:'))).toBe(true);
      expect(trusted).toContain('mutes:v1');
      expect(useMutes.getState().people[bobId]).toEqual({ places: false, pokes: true });
      expect(mockSecure.has('bargu.vault.v1')).toBe(true);

      await end();

      // The vault is shut, its key is deleted, and the file itself holds nothing: opening it again
      // (with a new key) finds no trust record, no mute and no record of who was met.
      expect(isVaultOpen()).toBe(false);
      expect(mockSecure.has('bargu.vault.v1')).toBe(false);
      expect([...(mockFiles.get('bargu-vault') ?? new Map()).keys()]).toEqual([]);
      expect(trusted.length).toBeGreaterThan(2);
      // Nor does the next account on this phone find it in memory.
      expect(useMutes.getState().people).toEqual({});
      await openVault();
      expect(vault().keys()).toEqual([]);
    },
  );
});
