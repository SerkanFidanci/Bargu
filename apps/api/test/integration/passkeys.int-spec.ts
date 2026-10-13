import type { DeviceKeys } from '@bargu/crypto';
import type { Me, Session } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PASSKEY_ALGORITHMS } from '../../src/auth/passkeys.service.js';
import { SoftwareAuthenticator } from '../support/authenticator.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login, newDevice, registration, uniqueEmail } from './support/client.js';

const ORIGIN = 'https://bargu.example.test';
let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

interface Options<T> {
  challengeId: string;
  options: T;
}

async function registerPasskey(session: Session, device: DeviceKeys) {
  const authenticator = await SoftwareAuthenticator.create();
  const start = await call(test.app, {
    url: '/v1/auth/passkey/register/options',
    accessToken: session.accessToken,
    device,
  });
  const { challengeId, options } =
    start.json<Options<{ challenge: string; rp: { id: string }; user: { id: string } }>>();
  const response = await authenticator.register(options, ORIGIN);
  const finish = await call(test.app, {
    url: '/v1/auth/passkey/register',
    body: { challengeId, response },
    accessToken: session.accessToken,
    device,
  });
  return { authenticator, finish, options };
}

async function passkeyLogin(
  authenticator: SoftwareAuthenticator,
  userId: string,
  tamper: Parameters<SoftwareAuthenticator['assert']>[3] = {},
  device = newDevice(),
) {
  const start = await call(test.app, { url: '/v1/auth/passkey/options' });
  const { challengeId, options } = start.json<Options<{ challenge: string; rpId: string }>>();
  const response = await authenticator.assert(options, ORIGIN, userId, tamper);
  const body = { challengeId, response, device: registration(device) };
  return {
    result: await call(test.app, { url: '/v1/auth/passkey/verify', body, device }),
    replay: () => call(test.app, { url: '/v1/auth/passkey/verify', body, device }),
  };
}

describe('passkeys', () => {
  it('register after an email login, then sign in with the passkey alone', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const { authenticator, finish, options } = await registerPasskey(session, device);
    expect(finish.statusCode).toBe(204);
    // Discoverable credential, user verification required, user handle = account id.
    expect(options.rp.id).toBe('bargu.example.test');
    expect(Buffer.from(options.user.id, 'base64url').toString('hex')).toBe(
      session.userId.replaceAll('-', ''),
    );

    const me = await call(test.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: session.accessToken,
    });
    expect(me.json<Me>().passkeys).toBe(1);

    const { result } = await passkeyLogin(authenticator, session.userId);
    expect(result.statusCode).toBe(200);
    const next = result.json<Session>();
    expect(next).toMatchObject({ userId: session.userId, isNewUser: false });
    // The passkey login registered a new device, which replaced the old one.
    const old = await call(test.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: session.accessToken,
    });
    expect(old.json()).toMatchObject({ code: 'DEVICE_REVOKED' });
  });

  it('rejects a challenge used twice, a forged user handle, a wrong key and a replayed counter', async () => {
    const owner = await login(test, uniqueEmail());
    const other = await login(test, uniqueEmail());
    const { authenticator } = await registerPasskey(owner.session, owner.device);

    const first = await passkeyLogin(authenticator, owner.session.userId);
    expect(first.result.statusCode).toBe(200);
    expect((await first.replay()).json()).toMatchObject({ code: 'PASSKEY_INVALID' });

    const forged = await passkeyLogin(authenticator, other.session.userId);
    expect(forged.result.json()).toMatchObject({ code: 'PASSKEY_INVALID' });

    const impostor = await SoftwareAuthenticator.create();
    const wrongKey = await passkeyLogin(authenticator, owner.session.userId, {
      signWith: impostor,
    });
    expect(wrongKey.result.json()).toMatchObject({ code: 'PASSKEY_INVALID' });

    const cloned = await passkeyLogin(authenticator, owner.session.userId, { counter: 1 });
    expect(cloned.result.json()).toMatchObject({ code: 'PASSKEY_INVALID' });
  });

  it('asks for what every phone can create: a visible name and standard algorithms', async () => {
    const account = await login(test, uniqueEmail());
    await call(test.app, {
      method: 'PATCH',
      url: '/v1/me',
      body: { displayName: 'Ayşe' },
      accessToken: account.session.accessToken,
      device: account.device,
    });
    const start = await call(test.app, {
      url: '/v1/auth/passkey/register/options',
      accessToken: account.session.accessToken,
      device: account.device,
    });
    const { options } =
      start.json<Options<{ user: { displayName: string }; pubKeyCredParams: { alg: number }[] }>>();
    // Android's passkey providers refuse an empty display name or an unknown algorithm (ML-DSA).
    expect(options.user.displayName).toBe('Ayşe');
    expect(options.pubKeyCredParams.map((param) => param.alg)).toEqual(PASSKEY_ALGORITHMS);
  });

  it('keeps a registration challenge to the account that asked for it', async () => {
    const alice = await login(test, uniqueEmail());
    const bob = await login(test, uniqueEmail());
    const start = await call(test.app, {
      url: '/v1/auth/passkey/register/options',
      accessToken: alice.session.accessToken,
      device: alice.device,
    });
    const { challengeId, options } =
      start.json<Options<{ challenge: string; rp: { id: string } }>>();
    const response = await (await SoftwareAuthenticator.create()).register(options, ORIGIN);
    const stolen = await call(test.app, {
      url: '/v1/auth/passkey/register',
      body: { challengeId, response },
      accessToken: bob.session.accessToken,
      device: bob.device,
    });
    expect(stolen.json()).toMatchObject({ code: 'PASSKEY_INVALID' });
  });

  it('refuses to register the same credential twice', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const authenticator = await SoftwareAuthenticator.create();
    const register = async () => {
      const start = await call(test.app, {
        url: '/v1/auth/passkey/register/options',
        accessToken: session.accessToken,
        device,
      });
      const { challengeId, options } =
        start.json<Options<{ challenge: string; rp: { id: string } }>>();
      return call(test.app, {
        url: '/v1/auth/passkey/register',
        body: { challengeId, response: await authenticator.register(options, ORIGIN) },
        accessToken: session.accessToken,
        device,
      });
    };
    expect((await register()).statusCode).toBe(204);
    const again = await register();
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'PASSKEY_INVALID' });
  });

  it('refuses a registration made for another origin', async () => {
    const { session, device } = await login(test, uniqueEmail());
    const start = await call(test.app, {
      url: '/v1/auth/passkey/register/options',
      accessToken: session.accessToken,
      device,
    });
    const { challengeId, options } =
      start.json<Options<{ challenge: string; rp: { id: string } }>>();
    const response = await (
      await SoftwareAuthenticator.create()
    ).register(options, 'https://evil.example');
    const finish = await call(test.app, {
      url: '/v1/auth/passkey/register',
      body: { challengeId, response },
      accessToken: session.accessToken,
      device,
    });
    expect(finish.json()).toMatchObject({ code: 'PASSKEY_INVALID' });
  });
});
