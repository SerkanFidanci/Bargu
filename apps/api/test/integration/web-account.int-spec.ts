import { deriveWebCode, emailLookupKey, toBase64url } from '@bargu/crypto';
import type { Circle, WebChallenge, WebSession } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthKeys } from '../../src/auth/auth-keys.js';
import { WEB_LIMITS } from '../../src/auth/web-account.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { EmailJobs } from '../../src/jobs/email-jobs.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login, uniqueEmail } from './support/client.js';
import { as, circleWith, person } from './support/people.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

/** What the page keeps for its tab: a random 32-byte value. */
const newBinding = () => toBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));

const askCode = (email: string, binding: string) =>
  call(test.app, { url: '/v1/web/code', body: { email, locale: 'tr', binding } });

const verify = (challengeId: string, code: string, binding: string) =>
  call(test.app, { url: '/v1/web/verify', body: { challengeId, code, binding } });

const revoke = (token: string) => call(test.app, { url: '/v1/web/revoke-device', body: { token } });

const codeFor = (challengeId: string) => deriveWebCode(test.env.OTP_KEY, challengeId);
const wrongCode = (code: string) => String((Number(code) + 1) % 100_000_000).padStart(8, '0');

describe('the account web page (docs/ADR/0021)', () => {
  it('takes a lost phone off the account with an emailed code: no session, new keys', async () => {
    const [owner, friend] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, owner, friend);
    const binding = newBinding();

    const asked = await askCode(owner.email, binding);
    expect(asked.statusCode).toBe(202);
    const { challengeId } = asked.json<WebChallenge>();
    // A wrong code, or the right one from another page: refused.
    expect(
      (await verify(challengeId, wrongCode(codeFor(challengeId)), binding)).json(),
    ).toMatchObject({ code: 'OTP_INVALID' });
    expect((await verify(challengeId, codeFor(challengeId), newBinding())).json()).toMatchObject({
      code: 'OTP_INVALID',
    });
    const verified = await verify(challengeId, codeFor(challengeId), binding);
    expect(verified.statusCode).toBe(200);
    const session = verified.json<WebSession>();
    expect(session.device).toMatchObject({ platform: 'android' });
    // The code was used up.
    expect((await verify(challengeId, codeFor(challengeId), binding)).statusCode).toBe(400);

    const done = await revoke(session.token);
    expect(done.json()).toEqual({ revoked: true });
    // One action per session.
    expect((await revoke(session.token)).statusCode).toBe(401);

    // The phone is out: its access token no longer works, nor its refresh token.
    expect(
      (
        await call(test.app, {
          method: 'GET',
          url: '/v1/me',
          accessToken: owner.session.accessToken,
        })
      ).statusCode,
    ).toBe(401);
    const refreshed = await call(test.app, {
      url: '/v1/auth/refresh',
      body: { refreshToken: owner.session.refreshToken },
      device: owner.device,
    });
    expect(refreshed.statusCode).toBe(401);
    const { rows } = await test.admin.query<{ type: string; reason: string | null }>(
      `SELECT e.type, d.revoked_reason AS reason FROM app.security_events e
         JOIN app.devices d ON d.id = e.device_id
        WHERE e.user_id = $1 AND e.type = 'device_revoked_remote'`,
      [owner.userId],
    );
    expect(rows).toEqual([{ type: 'device_revoked_remote', reason: 'remote' }]);
    // The circle moved to a new epoch, as for any device change.
    const after = (await as(test, friend, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(after.epoch).toBeGreaterThan(circle.epoch);
  });

  it('answers the same for an address without an account, and sends it nothing', async () => {
    const jobs = test.app.get(EmailJobs);
    const sent = vi.spyOn(jobs, 'enqueueWebCode');
    const binding = newBinding();
    const nobody = await askCode(uniqueEmail(), binding);
    expect(nobody.statusCode).toBe(202);
    const { challengeId } = nobody.json<WebChallenge>();
    expect(sent).not.toHaveBeenCalled();
    // Checking a code answers as for a real account: wrong, not "expired".
    expect((await verify(challengeId, codeFor(challengeId), binding)).json()).toMatchObject({
      code: 'OTP_INVALID',
    });
    const someone = await person(test);
    await askCode(someone.email, binding);
    expect(sent).toHaveBeenCalledTimes(1);
    sent.mockRestore();
  });

  it('holds back guessing and mail bombing, and spends none of the login budgets', async () => {
    const someone = await person(test);
    const binding = newBinding();
    // Three wrong codes kill a challenge.
    const { challengeId } = (await askCode(someone.email, binding)).json<WebChallenge>();
    const wrong = wrongCode(codeFor(challengeId));
    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect((await verify(challengeId, wrong, binding)).statusCode).toBe(400);
    }
    expect((await verify(challengeId, codeFor(challengeId), binding)).json()).toMatchObject({
      code: 'OTP_LOCKED',
    });
    // A few wrong codes a day per address, whatever the challenge.
    const address = Buffer.from(
      emailLookupKey(test.app.get(AuthKeys).emailLookupKey, someone.email),
    ).toString('hex');
    await test.app
      .get<RedisClient>(REDIS)
      .set(`rl:web-fail:${address}`, String(WEB_LIMITS.failuresPerDay), { EX: 3600 });
    const next = (await askCode(someone.email, binding)).json<WebChallenge>();
    expect(
      (await verify(next.challengeId, codeFor(next.challengeId), binding)).json(),
    ).toMatchObject({ code: 'OTP_LOCKED' });
    // A few codes an hour per address (this is the fourth).
    expect((await askCode(someone.email, binding)).statusCode).toBe(202);
    const limited = await askCode(someone.email, binding);
    expect(limited.statusCode).toBe(429);
    // The login code still works for this address.
    expect((await login(test, someone.email)).session.userId).toBe(someone.userId);
  });

  it('serves its page with nothing from elsewhere and a strict content policy', async () => {
    const page = await test.app.inject({ method: 'GET', url: '/hesap' });
    expect(page.statusCode).toBe(200);
    expect(page.headers['content-type']).toContain('text/html');
    const policy = String(page.headers['content-security-policy']);
    for (const rule of ["default-src 'none'", "script-src 'self'", "frame-ancestors 'none'"]) {
      expect(policy).toContain(rule);
    }
    expect(page.body).toContain('/hesap/app.js');
    expect(page.body).not.toMatch(/https?:\/\//);
    const script = await test.app.inject({ method: 'GET', url: '/hesap/app.js' });
    expect(script.headers['content-type']).toContain('javascript');
    expect(script.body).toContain('/v1/web/revoke-device');
    // An unknown session does nothing.
    expect((await revoke(toBase64url(new Uint8Array(32)))).statusCode).toBe(401);
  });
});
