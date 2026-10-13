import type { Me, Session } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OTP_LIMITS, OTP_MAX_ATTEMPTS } from '../../src/auth/otp.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import {
  call,
  codeFor,
  login,
  newDevice,
  nextIp,
  registration,
  requestCode,
  uniqueEmail,
} from './support/client.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const wrongCode = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('email code login', () => {
  it('creates the account on first login and finds it again on the next', async () => {
    const email = uniqueEmail();
    const first = await login(test, email);
    expect(first.session.isNewUser).toBe(true);

    const again = await login(test, email.toUpperCase());
    expect(again.session.isNewUser).toBe(false);
    expect(again.session.userId).toBe(first.session.userId);

    const me = await call(test.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: again.session.accessToken,
    });
    expect(me.statusCode).toBe(200);
    expect(me.json<Me>()).toMatchObject({
      userId: first.session.userId,
      device: { id: again.device.deviceId, platform: 'android', attested: false },
    });
  });

  it('stores no email address and no code anywhere', async () => {
    const email = uniqueEmail();
    const { session } = await login(test, email);
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(u)::text AS dump FROM app.users u WHERE id = $1`,
      [session.userId],
    );
    expect(rows[0]?.dump).not.toContain(email);
    const jobs = await test.admin.query<{ data: string }>(`SELECT data::text FROM pgboss.job`);
    expect(jobs.rows.length).toBeGreaterThan(0);
    for (const job of jobs.rows) expect(job.data).not.toContain('@example.test');
  });

  it('accepts a code once', async () => {
    const device = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail());
    const body = { challengeId, code: codeFor(test, challengeId), device: registration(device) };
    const url = '/v1/auth/otp/verify';
    expect((await call(test.app, { url, body, device })).statusCode).toBe(200);
    const reuse = await call(test.app, { url, body, device });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('lets exactly one of two concurrent correct submissions win', async () => {
    const { challengeId } = await requestCode(test, uniqueEmail());
    const code = codeFor(test, challengeId);
    const [a, b] = [newDevice(), newDevice()];
    const results = await Promise.all(
      [a, b].map((device) =>
        call(test.app, {
          url: '/v1/auth/otp/verify',
          body: { challengeId, code, device: registration(device) },
          device,
        }),
      ),
    );
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 400]);
  });
});

describe('brute force protection', () => {
  it('kills a challenge after five wrong codes, even if the sixth is right', async () => {
    const device = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail());
    const code = codeFor(test, challengeId);
    const attempt = (value: string) =>
      call(test.app, {
        url: '/v1/auth/otp/verify',
        body: { challengeId, code: value, device: registration(device) },
        device,
      });
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect((await attempt(wrongCode(code))).json()).toMatchObject({ code: 'OTP_INVALID' });
    }
    const last = await attempt(code);
    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('locks the address after too many wrong codes across challenges', async () => {
    const email = uniqueEmail();
    const device = newDevice();
    let failures = 0;
    while (failures < OTP_LIMITS.failuresPerEmail) {
      const { challengeId } = await requestCode(test, email);
      for (let i = 0; i < 3 && failures < OTP_LIMITS.failuresPerEmail; i++, failures++) {
        await call(test.app, {
          url: '/v1/auth/otp/verify',
          body: {
            challengeId,
            code: wrongCode(codeFor(test, challengeId)),
            device: registration(device),
          },
          device,
        });
      }
    }
    const locked = await call(test.app, {
      url: '/v1/auth/otp/request',
      body: { email, locale: 'en' },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('limits code requests per address and per IP, with Retry-After', async () => {
    const email = uniqueEmail();
    for (let i = 0; i < OTP_LIMITS.requestsPerEmail; i++) await requestCode(test, email);
    const perEmail = await call(test.app, {
      url: '/v1/auth/otp/request',
      body: { email, locale: 'tr' },
    });
    expect(perEmail.statusCode).toBe(429);
    expect(Number(perEmail.headers['retry-after'])).toBeGreaterThan(0);

    const ip = nextIp();
    for (let i = 0; i < OTP_LIMITS.requestsPerIp; i++) await requestCode(test, uniqueEmail(), ip);
    const perIp = await call(test.app, {
      url: '/v1/auth/otp/request',
      body: { email: uniqueEmail(), locale: 'tr' },
      ip,
    });
    expect(perIp.statusCode).toBe(429);
    expect(perIp.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });
});

describe('device proof at login', () => {
  async function verify(options: {
    sign?: Parameters<typeof call>[1]['sign'];
    unsigned?: boolean;
    tamperBundle?: boolean;
  }) {
    const device = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail());
    const reg = registration(device);
    if (options.tamperBundle === true) reg.bundle.dhKey = registration(newDevice()).bundle.dhKey;
    return call(test.app, {
      url: '/v1/auth/otp/verify',
      body: { challengeId, code: codeFor(test, challengeId), device: reg },
      ...(options.unsigned === true ? {} : { device }),
      ...(options.sign === undefined ? {} : { sign: options.sign }),
    });
  }

  it('requires the new device to sign the request', async () => {
    expect((await verify({ unsigned: true })).json()).toMatchObject({ code: 'SIGNATURE_REQUIRED' });
  });

  it('rejects a signature by another key, an old timestamp or a DH key not signed by it', async () => {
    expect((await verify({ sign: { signer: newDevice() } })).json()).toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
    expect((await verify({ sign: { timestamp: Date.now() - 120_000 } })).json()).toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
    expect((await verify({ tamperBundle: true })).json()).toMatchObject({
      code: 'DEVICE_KEYS_INVALID',
    });
  });
});

describe('access tokens and signed requests', () => {
  let session: Session;
  let device: ReturnType<typeof newDevice>;
  beforeAll(async () => {
    ({ session, device } = await login(test, uniqueEmail()));
  });

  it('protects every non-public route', async () => {
    const response = await call(test.app, { method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({
      statusCode: 401,
      error: 'UNAUTHORIZED',
      code: 'UNAUTHENTICATED',
    });
    const forged = await call(test.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: `${session.accessToken.slice(0, -4)}AAAA`,
    });
    expect(forged.statusCode).toBe(401);
  });

  it('demands a device signature on state-changing requests, and accepts each one once', async () => {
    const unsigned = await call(test.app, {
      url: '/v1/auth/passkey/register/options',
      accessToken: session.accessToken,
    });
    expect(unsigned.json()).toMatchObject({ code: 'SIGNATURE_REQUIRED' });

    const nonce = 'AAAAAAAAAAAAAAAAAAAAAA';
    const signed = () =>
      call(test.app, {
        url: '/v1/auth/passkey/register/options',
        accessToken: session.accessToken,
        device,
        sign: { nonce },
      });
    expect((await signed()).statusCode).toBe(200);
    expect((await signed()).json()).toMatchObject({ code: 'SIGNATURE_INVALID' });
  });
});
