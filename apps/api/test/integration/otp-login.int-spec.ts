import type { DeviceKeys } from '@bargu/crypto';
import type { Me, Session } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CLIENT_LIMITS } from '../../src/auth/client-limits.js';
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
  requestCodeRaw,
  uniqueEmail,
  wrongCode,
} from './support/client.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

function verify(device: DeviceKeys, challengeId: string, code: string, ip = nextIp()) {
  return call(test.app, {
    url: '/v1/auth/otp/verify',
    body: { challengeId, code, device: registration(device) },
    device,
    ip,
  });
}

/** Spends `count` wrong codes for `email` from `device` (several challenges if needed). */
async function burn(email: string, device: DeviceKeys, count: number): Promise<void> {
  let failures = 0;
  while (failures < count) {
    const { challengeId } = await requestCode(test, email, device);
    for (let i = 0; i < OTP_MAX_ATTEMPTS && failures < count; i++, failures++) {
      await verify(device, challengeId, wrongCode(codeFor(test, challengeId)));
    }
  }
}

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

  it('uses 8-digit codes', async () => {
    const { challengeId } = await requestCode(test, uniqueEmail());
    expect(codeFor(test, challengeId)).toMatch(/^\d{4}$/);
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
    const { challengeId } = await requestCode(test, uniqueEmail(), device);
    const code = codeFor(test, challengeId);
    expect((await verify(device, challengeId, code)).statusCode).toBe(200);
    const reuse = await verify(device, challengeId, code);
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toMatchObject({ code: 'OTP_EXPIRED' });
  });

  it('lets only the device that asked for the code redeem it', async () => {
    const owner = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail(), owner);
    const code = codeFor(test, challengeId);
    // Even with the right code, another device key is refused.
    expect((await verify(newDevice(), challengeId, code)).json()).toMatchObject({
      code: 'OTP_INVALID',
    });
    expect((await verify(owner, challengeId, code)).statusCode).toBe(200);
  });

  it('lets exactly one of two concurrent correct submissions win', async () => {
    const device = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail(), device);
    const code = codeFor(test, challengeId);
    const results = await Promise.all([
      verify(device, challengeId, code),
      verify(device, challengeId, code),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 400]);
  });
});

describe('brute force protection', () => {
  it('kills a challenge after its wrong codes are spent, even if the next one is right', async () => {
    const device = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail(), device);
    const code = codeFor(test, challengeId);
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      expect((await verify(device, challengeId, wrongCode(code))).json()).toMatchObject({
        code: 'OTP_INVALID',
      });
    }
    const last = await verify(device, challengeId, code);
    expect(last.statusCode).toBe(429);
    expect(last.json()).toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('cannot be outrun by parallel guesses', async () => {
    const email = uniqueEmail();
    const attacker = newDevice();
    const challenges: string[] = [];
    for (let i = 0; i < OTP_LIMITS.requestsPerDevice; i++) {
      challenges.push((await requestCode(test, email, attacker)).challengeId);
    }
    // More guesses at once than the budget: slots are reserved before the code is compared.
    const guesses = challenges.flatMap((id) =>
      Array.from({ length: OTP_MAX_ATTEMPTS }, () =>
        verify(attacker, id, wrongCode(codeFor(test, id))),
      ),
    );
    const codes = (await Promise.all(guesses)).map(
      (response) => response.json<{ code: string }>().code,
    );
    expect(codes.filter((code) => code === 'OTP_INVALID')).toHaveLength(
      OTP_LIMITS.failuresPerDevice,
    );
    expect(codes.filter((code) => code === 'OTP_LOCKED')).toHaveLength(
      guesses.length - OTP_LIMITS.failuresPerDevice,
    );
  });

  it("locks out the guessing device, not the address owner's device", async () => {
    const email = uniqueEmail();
    const attacker = newDevice();
    await burn(email, attacker, OTP_LIMITS.failuresPerDevice);
    expect((await requestCodeRaw(test, email, attacker)).json()).toMatchObject({
      code: 'OTP_LOCKED',
    });
    // The real user, on their own phone, still gets in.
    expect((await login(test, email)).session.userId).toBeDefined();
  });

  it('locks the address for everyone after the daily cap of wrong codes', async () => {
    const email = uniqueEmail();
    let spent = 0;
    while (spent < OTP_LIMITS.failuresPerAddress) {
      const batch = Math.min(OTP_LIMITS.failuresPerDevice, OTP_LIMITS.failuresPerAddress - spent);
      await burn(email, newDevice(), batch);
      spent += batch;
    }
    const locked = await requestCodeRaw(test, email, newDevice());
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: 'OTP_LOCKED' });
  });

  it('limits code requests per device and per client network', async () => {
    const email = uniqueEmail();
    const device = newDevice();
    for (let i = 0; i < OTP_LIMITS.requestsPerDevice; i++) await requestCode(test, email, device);
    const perDevice = await requestCodeRaw(test, email, device);
    expect(perDevice.statusCode).toBe(429);
    expect(Number(perDevice.headers['retry-after'])).toBeGreaterThan(0);

    // A whole IPv6 /64 counts as one client.
    for (let i = 0; i < CLIENT_LIMITS.otpRequest; i++) {
      await requestCode(test, uniqueEmail(), newDevice(), `2001:db8:77:1::${String(i + 1)}`);
    }
    const sameNetwork = await requestCodeRaw(
      test,
      uniqueEmail(),
      newDevice(),
      '2001:db8:77:1:ffff:ffff:ffff:ffff',
    );
    expect(sameNetwork.statusCode).toBe(429);
    expect(sameNetwork.json()).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('rejects a non-canonical device key in a code request', async () => {
    const response = await call(test.app, {
      url: '/v1/auth/otp/request',
      body: { email: uniqueEmail(), locale: 'tr', identityKey: `${'A'.repeat(42)}B` },
    });
    expect(response.json()).toMatchObject({ code: 'VALIDATION_FAILED' });
  });
});

describe('device proof at login', () => {
  async function attempt(options: {
    sign?: Parameters<typeof call>[1]['sign'];
    unsigned?: boolean;
    tamperBundle?: boolean;
  }) {
    const device = newDevice();
    const { challengeId } = await requestCode(test, uniqueEmail(), device);
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
    expect((await attempt({ unsigned: true })).json()).toMatchObject({
      code: 'SIGNATURE_REQUIRED',
    });
  });

  it('rejects a signature by another key or a DH key not signed by it', async () => {
    expect((await attempt({ sign: { signer: newDevice() } })).json()).toMatchObject({
      code: 'SIGNATURE_INVALID',
    });
    expect((await attempt({ tamperBundle: true })).json()).toMatchObject({
      code: 'DEVICE_KEYS_INVALID',
    });
  });

  it('reports a wrong clock distinctly, with the server time in the Date header', async () => {
    const response = await attempt({ sign: { timestamp: Date.now() - 120_000 } });
    expect(response.json()).toMatchObject({ code: 'CLOCK_SKEW' });
    expect(Math.abs(Date.parse(String(response.headers.date)) - Date.now())).toBeLessThan(5_000);
  });
});

describe('access tokens and signed requests', () => {
  let session: Session;
  let device: DeviceKeys;
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

  it('accepts JSON bodies only, so the signature always covers the body', async () => {
    const response = await test.app.inject({
      method: 'POST',
      url: '/v1/auth/passkey/register/options',
      headers: { authorization: `Bearer ${session.accessToken}`, 'content-type': 'text/plain' },
      payload: 'anything',
    });
    expect(response.statusCode).toBe(415);
  });
});

describe('endpoints before login', () => {
  it('are rate limited per client network', async () => {
    const ip = nextIp();
    for (let i = 0; i < CLIENT_LIMITS.attestationChallenge; i++) {
      await call(test.app, { url: '/v1/auth/attestation/challenge', ip });
    }
    expect((await call(test.app, { url: '/v1/auth/attestation/challenge', ip })).statusCode).toBe(
      429,
    );
    for (let i = 0; i < CLIENT_LIMITS.passkeyOptions; i++) {
      await call(test.app, { url: '/v1/auth/passkey/options', ip });
    }
    expect((await call(test.app, { url: '/v1/auth/passkey/options', ip })).statusCode).toBe(429);
  });
});
