import { randomUuid, verifyRequestSignature } from '@bargu/crypto';
import type { Session } from '@bargu/schemas';

const mockStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockStore.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockStore.set(key, value);
    return Promise.resolve();
  }),
  deleteItemAsync: jest.fn((key: string) => {
    mockStore.delete(key);
    return Promise.resolve();
  }),
}));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));

import { useAgeAnswer } from '../account/age-answer';
import {
  api,
  bootstrapAuth,
  onSignedOut,
  requestCode,
  signOut,
  useAuth,
  verifyCode,
} from './auth-store';
import { loadDeviceKeys } from './device-key-store';

type Handler = (path: string, init: RequestInit) => { status: number; body?: unknown };
let handler: Handler = () => ({ status: 500 });
const calls: { path: string; init: RequestInit }[] = [];

globalThis.fetch = jest.fn((url: string | URL | Request, init?: RequestInit) => {
  const path = (url instanceof Request ? url.url : url.toString()).replace('https://api.test', '');
  calls.push({ path, init: init ?? {} });
  const { status, body } = handler(path, init ?? {});
  return Promise.resolve(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}) as typeof fetch;

/** Request bodies in these tests are always JSON strings. */
const bodyOf = (init: RequestInit | undefined) => (typeof init?.body === 'string' ? init.body : '');

const header = (init: RequestInit, name: string) =>
  (init.headers as Record<string, string> | undefined)?.[name];

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

beforeEach(() => {
  mockStore.clear();
  calls.length = 0;
  useAuth.setState({ status: 'loading', device: null, userId: null });
});

describe('sign-in', () => {
  it('binds the code request to a fresh device key and signs the verification with it', async () => {
    const challengeId = randomUuid();
    handler = (path, init) => {
      if (path === '/v1/auth/otp/request')
        return { status: 202, body: { challengeId, expiresIn: 600 } };
      const body = JSON.parse(bodyOf(init)) as { device: { bundle: { deviceId: string } } };
      return { status: 200, body: session(body.device.bundle.deviceId) };
    };

    await bootstrapAuth();
    expect(useAuth.getState().status).toBe('signedOut');
    await requestCode('ayse@example.test');
    const device = useAuth.getState().device;
    expect(device).not.toBeNull();
    const request = JSON.parse(bodyOf(calls[0]?.init)) as { identityKey: string };
    expect(request.identityKey).toHaveLength(43);

    // The age band answered before the email opens a new account with it (docs/ADR/0023).
    useAgeAnswer.setState({ answer: '15-17' });
    await verifyCode(challengeId, '12345678');
    useAgeAnswer.setState({ answer: null });
    const verify = calls[1];
    expect(verify?.path).toBe('/v1/auth/otp/verify');
    expect((JSON.parse(bodyOf(verify?.init)) as { ageBand?: string }).ageBand).toBe('15-17');
    expect(
      verifyRequestSignature(
        device?.identity.publicKey ?? new Uint8Array(),
        {
          method: 'POST',
          path: '/v1/auth/otp/verify',
          timestamp: Number(header(verify?.init ?? {}, 'x-bargu-ts')),
          nonce: header(verify?.init ?? {}, 'x-bargu-nonce') ?? '',
          deviceId: device?.deviceId ?? '',
          body: new TextEncoder().encode(bodyOf(verify?.init)),
        },
        header(verify?.init ?? {}, 'x-bargu-sig') ?? '',
      ),
    ).toBe(true);
    expect(useAuth.getState().status).toBe('signedIn');

    // A restart finds the same login.
    useAuth.setState({ status: 'loading', device: null, userId: null });
    await bootstrapAuth();
    expect(useAuth.getState()).toMatchObject({
      status: 'signedIn',
      device: { deviceId: device?.deviceId },
    });
  });

  it('treats half a login (session for other keys) as signed out and forgets that session', async () => {
    handler = () => ({ status: 202, body: { challengeId: randomUuid(), expiresIn: 600 } });
    await requestCode('ayse@example.test');
    mockStore.set('bargu.session.v1', JSON.stringify(session(randomUuid())));
    useAuth.setState({ status: 'loading', device: null });
    await bootstrapAuth();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(mockStore.has('bargu.session.v1')).toBe(false);
  });
});

describe('sign-out', () => {
  async function signedIn() {
    const challengeId = randomUuid();
    handler = (path, init) =>
      path === '/v1/auth/otp/request'
        ? { status: 202, body: { challengeId, expiresIn: 600 } }
        : {
            status: 200,
            body: session(
              (JSON.parse(bodyOf(init)) as { device: { bundle: { deviceId: string } } }).device
                .bundle.deviceId,
            ),
          };
    await bootstrapAuth();
    await requestCode('ayse@example.test');
    await verifyCode(challengeId, '12345678');
  }

  it('destroys the device keys and session even when the server cannot be reached', async () => {
    await signedIn();
    const listener = jest.fn();
    const unsubscribe = onSignedOut(listener);
    handler = () => {
      throw new TypeError('Network request failed');
    };
    await signOut();
    unsubscribe();
    expect(useAuth.getState().status).toBe('signedOut');
    expect(await loadDeviceKeys()).toBeNull();
    expect(mockStore.size).toBe(0);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('ends locally when the server says this device was replaced', async () => {
    await signedIn();
    handler = (path) =>
      path === '/v1/auth/refresh'
        ? { status: 401, body: { statusCode: 401, error: 'x', code: 'DEVICE_REVOKED' } }
        : { status: 401, body: { statusCode: 401, error: 'x', code: 'TOKEN_EXPIRED' } };
    await expect(api.authed('/v1/me')).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(useAuth.getState().status).toBe('signedOut');
    expect(await loadDeviceKeys()).toBeNull();
  });
});
