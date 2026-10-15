import { generateDeviceKeys, randomUuid, verifyRequestSignature } from '@bargu/crypto';
import type { Session } from '@bargu/schemas';

import { ApiError, createApiClient, type SessionStore } from './api-client';

const device = generateDeviceKeys(randomUuid());

function session(token: string): Session {
  return {
    userId: randomUuid(),
    deviceId: device.deviceId,
    accessToken: `access-${token}`,
    accessTokenExpiresAt: 0,
    refreshToken: `refresh-${token}`,
    refreshTokenExpiresAt: 0,
    isNewUser: false,
  };
}

function memoryStore(initial: Session | null): SessionStore & { current: Session | null } {
  const store = {
    current: initial,
    get: () => store.current,
    set: (next: Session | null) => {
      store.current = next;
      return Promise.resolve();
    },
  };
  return store;
}

type Handler = (url: string, init: RequestInit) => Response;

function client(store: SessionStore, handler: Handler) {
  const fetch = jest.fn((url: string, init: RequestInit) => Promise.resolve(handler(url, init)));
  const api = createApiClient({
    baseUrl: 'https://api.test',
    device: () => device,
    session: store,
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { api, fetch };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api client', () => {
  it('signs state-changing requests so the server can verify them', async () => {
    const store = memoryStore(session('a'));
    const { api, fetch } = client(store, () => new Response(null, { status: 204 }));
    await api.authed('/v1/auth/logout', { method: 'POST', body: { reason: 'test' } });

    const [, init] = fetch.mock.calls[0] ?? [];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(headers.authorization).toBe('Bearer access-a');
    const valid = verifyRequestSignature(
      device.identity.publicKey,
      {
        method: 'POST',
        path: '/v1/auth/logout',
        timestamp: Number(headers['x-bargu-ts']),
        nonce: headers['x-bargu-nonce'] ?? '',
        deviceId: device.deviceId,
        body: new TextEncoder().encode('{"reason":"test"}'),
      },
      headers['x-bargu-sig'] ?? '',
    );
    expect(valid).toBe(true);
  });

  it('does not sign reads', async () => {
    const { api, fetch } = client(memoryStore(session('a')), () => json(200, { ok: true }));
    expect(await api.authed('/v1/me')).toEqual({ ok: true });
    const headers = (fetch.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['x-bargu-sig']).toBeUndefined();
  });

  it('refreshes an expired access token once, even for concurrent requests', async () => {
    const store = memoryStore(session('old'));
    let refreshes = 0;
    const { api } = client(store, (url, init) => {
      if (url.endsWith('/v1/auth/refresh')) {
        refreshes += 1;
        return json(200, session('new'));
      }
      const auth = (init.headers as Record<string, string>).authorization;
      return auth === 'Bearer access-new'
        ? json(200, { ok: true })
        : json(401, { code: 'TOKEN_EXPIRED' });
    });
    const results = await Promise.all([api.authed('/v1/me'), api.authed('/v1/me')]);
    expect(results).toEqual([{ ok: true }, { ok: true }]);
    expect(refreshes).toBe(1);
    expect(store.current?.refreshToken).toBe('refresh-new');
  });

  it('ends the session when the refresh is refused', async () => {
    const store = memoryStore(session('old'));
    const { api } = client(store, (url) =>
      url.endsWith('/v1/auth/refresh')
        ? json(401, { code: 'REFRESH_INVALID' })
        : json(401, { code: 'TOKEN_EXPIRED' }),
    );
    await expect(api.authed('/v1/me')).rejects.toEqual(new ApiError(401, 'REFRESH_INVALID'));
    expect(store.current).toBeNull();
    await expect(api.authed('/v1/me')).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('corrects a wrong phone clock from the server Date header and retries once', async () => {
    const serverNow = Date.now() + 5 * 60 * 1000;
    const timestamps: number[] = [];
    const { api } = client(memoryStore(session('a')), (_url, init) => {
      const ts = Number((init.headers as Record<string, string>)['x-bargu-ts']);
      timestamps.push(ts);
      if (Math.abs(ts - serverNow) > 60_000) {
        return new Response(JSON.stringify({ code: 'CLOCK_SKEW' }), {
          status: 401,
          headers: { date: new Date(serverNow).toUTCString() },
        });
      }
      return new Response(null, { status: 204 });
    });
    await api.authed('/v1/auth/logout', { method: 'POST' });
    expect(timestamps).toHaveLength(2);
    expect(Math.abs((timestamps[1] ?? 0) - serverNow)).toBeLessThan(2_000);
  });

  it('keeps the session when a refresh fails for a transient reason', async () => {
    const store = memoryStore(session('old'));
    const { api } = client(store, (url) =>
      url.endsWith('/v1/auth/refresh')
        ? json(503, { code: 'UNAVAILABLE' })
        : json(401, { code: 'TOKEN_EXPIRED' }),
    );
    await expect(api.authed('/v1/me')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(store.current?.refreshToken).toBe('refresh-old');
  });

  it('ends the session when the server says this device was replaced or signed out', async () => {
    const store = memoryStore(session('a'));
    const { api } = client(store, () => json(401, { code: 'DEVICE_REVOKED' }));
    await expect(api.authed('/v1/me')).rejects.toMatchObject({ code: 'DEVICE_REVOKED' });
    expect(store.current).toBeNull();
  });

  it('signs the event socket handshake with a fresh token', async () => {
    const store = memoryStore({ ...session('old'), accessTokenExpiresAt: Date.now() + 5_000 });
    const { api } = client(store, (url) =>
      url.endsWith('/v1/auth/refresh')
        ? json(200, { ...session('new'), accessTokenExpiresAt: Date.now() + 600_000 })
        : json(404, {}),
    );
    const handshake = await api.socketHandshake('/v1/events');
    // Expiring within half a minute: refreshed first, so the server does not refuse it.
    expect(handshake.token).toBe('access-new');
    expect(
      verifyRequestSignature(
        device.identity.publicKey,
        {
          method: 'GET',
          path: '/v1/events',
          timestamp: Number(handshake.ts),
          nonce: handshake.nonce,
          deviceId: device.deviceId,
          body: new Uint8Array(0),
        },
        handshake.sig,
      ),
    ).toBe(true);
    const again = await api.socketHandshake('/v1/events');
    expect(again.token).toBe('access-new');
    expect(again.nonce).not.toBe(handshake.nonce);
  });

  it('surfaces API error codes', async () => {
    const { api } = client(memoryStore(null), () => json(429, { code: 'RATE_LIMITED' }));
    await expect(
      api.public('/v1/auth/otp/request', { method: 'POST', body: {} }),
    ).rejects.toMatchObject({ status: 429, code: 'RATE_LIMITED' });
  });

  it('gives up a stuck attempt and tries once more, newly signed (QA Faz 8: a 15 s accept)', async () => {
    const store = memoryStore(session('a'));
    let calls = 0;
    const nonces: string[] = [];
    const fetch = jest.fn((_url: string, init: RequestInit) => {
      calls += 1;
      nonces.push((init.headers as Record<string, string>)['x-bargu-nonce'] ?? '');
      if (calls > 1) return Promise.resolve(json(200, { ok: true }));
      // A dead connection: nothing comes back until the attempt is given up.
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      });
    });
    const api = createApiClient({
      baseUrl: 'https://api.test',
      device: () => device,
      session: store,
      fetch: fetch as unknown as typeof globalThis.fetch,
      timeoutMs: 20,
    });
    await expect(
      api.authed('/v1/circles/x/accept', { method: 'POST', idempotent: true }),
    ).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
    expect(nonces[0]).not.toBe(nonces[1]);

    // Anything else is sent once: the first may have gone through (QA Faz 9 B1, a second circle).
    calls = 0;
    await expect(api.authed('/v1/circles', { method: 'POST', body: {} })).rejects.toThrow(
      'aborted',
    );
    expect(calls).toBe(1);

    // Twice stuck: the error goes to the caller (the screen says so).
    const stuck = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    const api2 = createApiClient({
      baseUrl: 'https://api.test',
      device: () => device,
      session: store,
      fetch: stuck as unknown as typeof globalThis.fetch,
      timeoutMs: 20,
    });
    await expect(api2.authed('/v1/circles')).rejects.toThrow('aborted');
    expect(stuck).toHaveBeenCalledTimes(2);
  });

  it('gives a large upload its own, longer deadline (QA Faz 9 slice 1, B5)', async () => {
    const store = memoryStore(session('a'));
    // An answer that takes longer than the usual deadline but less than the upload's own.
    const fetch = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const timer = setTimeout(() => {
            resolve(json(200, { ok: true }));
          }, 60);
          init.signal?.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('aborted'));
          });
        }),
    );
    const api = createApiClient({
      baseUrl: 'https://api.test',
      device: () => device,
      session: store,
      fetch: fetch as unknown as typeof globalThis.fetch,
      timeoutMs: 20,
    });
    await expect(
      api.authed('/v1/me/photo', { method: 'PUT', body: {}, timeoutMs: 500 }),
    ).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledTimes(1);
    // The usual deadline would have given it up.
    await expect(api.authed('/v1/me/photo', { method: 'PUT', body: {} })).rejects.toThrow(
      'aborted',
    );
  });
});
