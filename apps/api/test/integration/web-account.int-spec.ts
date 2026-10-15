import { Script } from 'node:vm';

import { deriveWebCode, deriveWebUnlockToken, emailLookupKey, toBase64url } from '@bargu/crypto';
import type { Circle, WebChallenge, WebSession, WebUnlocked } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthKeys } from '../../src/auth/auth-keys.js';
import { ClientLimits } from '../../src/auth/client-limits.js';
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

/** The owner's network and someone else's (budgets are per address and network). */
const HOME = '198.51.100.7';
const ELSEWHERE = '203.0.113.9';

const askCode = (email: string, binding: string, ip = HOME) =>
  call(test.app, { url: '/v1/web/code', body: { email, locale: 'tr', binding }, ip });

const verify = (challengeId: string, code: string, binding: string, ip = HOME) =>
  call(test.app, { url: '/v1/web/verify', body: { challengeId, code, binding }, ip });

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
    // A few wrong codes a day per address and network, whatever the challenge; someone else
    // using them up from their network does not lock the owner out (QA 3b N1).
    const address = Buffer.from(
      emailLookupKey(test.app.get(AuthKeys).emailLookupKey, someone.email),
    ).toString('hex');
    const redis = test.app.get<RedisClient>(REDIS);
    const elsewhere = test.app.get(ClientLimits).networkId(ELSEWHERE);
    await redis.set(
      `rl:web-fail-n:${address}:${elsewhere}`,
      String(WEB_LIMITS.failuresPerNetworkDay),
      { EX: 3600 },
    );
    const theirs = (await askCode(someone.email, binding, ELSEWHERE)).json<WebChallenge>();
    expect(
      (await verify(theirs.challengeId, codeFor(theirs.challengeId), binding, ELSEWHERE)).json(),
    ).toMatchObject({ code: 'OTP_LOCKED' });
    const owners = newBinding();
    const mine = (await askCode(someone.email, owners)).json<WebChallenge>();
    expect((await verify(mine.challengeId, codeFor(mine.challengeId), owners)).statusCode).toBe(
      200,
    );
    // From everywhere together, a far higher ceiling.
    await redis.set(`rl:web-fail-a:${address}`, String(WEB_LIMITS.failuresPerAddressDay), {
      EX: 3600,
    });
    const next = (await askCode(someone.email, owners)).json<WebChallenge>();
    expect(
      (await verify(next.challengeId, codeFor(next.challengeId), owners)).json(),
    ).toMatchObject({ code: 'OTP_LOCKED' });
    // A few codes a day per address and network: the fourth from home is refused, while the
    // same address can still be asked for from another network.
    const limited = await askCode(someone.email, binding);
    expect(limited.statusCode).toBe(429);
    expect((await askCode(someone.email, binding, '192.0.2.44')).statusCode).toBe(202);
    // The login code still works for this address.
    expect((await login(test, someone.email)).session.userId).toBe(someone.userId);
  });

  it('lets a browser that came in before past what all networks together have (QA 4 K2)', async () => {
    const someone = await person(test);
    const binding = newBinding();
    const first = (await askCode(someone.email, binding)).json<WebChallenge>();
    const { remember } = (
      await verify(first.challengeId, codeFor(first.challengeId), binding)
    ).json<WebSession>();
    expect(remember).toMatch(/^[A-Za-z0-9_-]{43}$/);

    // Someone who knows the address used up, from many networks, all it has for the day.
    const address = Buffer.from(
      emailLookupKey(test.app.get(AuthKeys).emailLookupKey, someone.email),
    ).toString('hex');
    const redis = test.app.get<RedisClient>(REDIS);
    await redis.set(`rl:web-req-a:${address}`, String(WEB_LIMITS.requestsPerAddressDay), {
      EX: 3600,
    });
    await redis.set(`rl:web-fail-a:${address}`, String(WEB_LIMITS.failuresPerAddressDay), {
      EX: 3600,
    });
    const travelling = '192.0.2.77';
    const ask = (kept?: string) =>
      call(test.app, {
        url: '/v1/web/code',
        body: { email: someone.email, locale: 'tr', binding, remember: kept },
        ip: travelling,
      });
    // A stranger's browser, or one with a made-up value, is held back...
    expect((await ask()).statusCode).toBe(429);
    expect((await ask(newBinding())).statusCode).toBe(429);
    // ...the owner's own browser is not, from any network, and its code works.
    const asked = await ask(remember);
    expect(asked.statusCode).toBe(202);
    const { challengeId } = asked.json<WebChallenge>();
    const verified = await call(test.app, {
      url: '/v1/web/verify',
      body: { challengeId, code: codeFor(challengeId), binding, remember },
      ip: travelling,
    });
    expect(verified.statusCode).toBe(200);
    // What it keeps opens nothing by itself.
    expect(
      (await call(test.app, { url: '/v1/web/revoke-device', body: { token: remember } }))
        .statusCode,
    ).toBe(401);
    // Each value lasts its own 180 days, however often the account came in since (QA 4 K2c).
    const known = `web-known:${someone.userId}`;
    for (const value of await redis.zRange(known, 0, -1)) {
      await redis.zAdd(known, { score: Date.now() - 181 * 24 * 3600_000, value });
    }
    expect((await ask(remember)).statusCode).toBe(429);
  });

  it('emails the owner, once a day, a link that makes their browser a known one (QA 4 K2b)', async () => {
    const jobs = test.app.get(EmailJobs);
    const offered = vi.spyOn(jobs, 'enqueueWebUnlock');
    const redis = test.app.get<RedisClient>(REDIS);
    const lookup = test.app.get(AuthKeys).emailLookupKey;
    const fill = async (email: string) => {
      const address = Buffer.from(emailLookupKey(lookup, email)).toString('hex');
      await redis.set(`rl:web-req-a:${address}`, String(WEB_LIMITS.requestsPerAddressDay), {
        EX: 3600,
      });
      return address;
    };
    const [someone, other] = await Promise.all([person(test), person(test)]);
    const binding = newBinding();
    // Someone filled the address's ceiling from many networks; the owner, first time here, asks.
    const address = await fill(someone.email);
    const firstTime = '192.0.2.91';
    expect((await askCode(someone.email, binding, firstTime)).statusCode).toBe(429);
    await vi.waitFor(() => {
      expect(offered).toHaveBeenCalledTimes(1);
    });
    const [job] = offered.mock.calls[0] ?? [];
    expect(job).toMatchObject({ to: someone.email, locale: 'tr' });
    const id = job?.challengeId ?? '';
    // Asking again, from anywhere, the same day: no second email (whoever fills the ceiling can
    // make it come once a day, no more).
    expect((await askCode(someone.email, binding, '192.0.2.92')).statusCode).toBe(429);
    expect((await askCode(someone.email, binding, firstTime)).statusCode).toBe(429);
    // An address without an account gets nothing, and the same answer.
    await fill(uniqueEmail());
    const nobody = uniqueEmail();
    await fill(nobody);
    expect((await askCode(nobody, binding, firstTime)).statusCode).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(offered).toHaveBeenCalledTimes(1);

    const unlock = (body: { id: string; token: string }) =>
      call(test.app, { url: '/v1/web/unlock', body, ip: firstTime });
    const token = deriveWebUnlockToken(test.env.OTP_KEY, id);
    // A made-up secret, or the right one for another link: refused.
    expect((await unlock({ id, token: newBinding() })).json()).toMatchObject({
      code: 'OTP_INVALID',
    });
    const otherId = '0190f7a4-3333-7333-8333-0000000000aa';
    expect(
      (
        await unlock({ id: otherId, token: deriveWebUnlockToken(test.env.OTP_KEY, otherId) })
      ).json(),
    ).toMatchObject({ code: 'OTP_EXPIRED' });
    const opened = await unlock({ id, token });
    expect(opened.statusCode).toBe(200);
    const { remember } = opened.json<WebUnlocked>();
    expect(remember).toMatch(/^[A-Za-z0-9_-]{43}$/);
    // Works once.
    expect((await unlock({ id, token })).json()).toMatchObject({ code: 'OTP_EXPIRED' });
    // It opens nothing by itself...
    expect(
      (await call(test.app, { url: '/v1/web/revoke-device', body: { token: remember } }))
        .statusCode,
    ).toBe(401);
    // ...but the browser is past the ceiling now (on a network with requests left), and the code
    // from the email still decides.
    const laterOn = '192.0.2.95';
    const ask = (kept?: string) =>
      call(test.app, {
        url: '/v1/web/code',
        body: { email: someone.email, locale: 'tr', binding, remember: kept },
        ip: laterOn,
      });
    expect((await ask()).statusCode).toBe(429);
    const asked = await ask(remember);
    expect(asked.statusCode).toBe(202);
    const { challengeId } = asked.json<WebChallenge>();
    const verified = await call(test.app, {
      url: '/v1/web/verify',
      body: { challengeId, code: codeFor(challengeId), binding, remember },
      ip: laterOn,
    });
    expect(verified.statusCode).toBe(200);
    // Known to this account only.
    await fill(other.email);
    expect(
      (
        await call(test.app, {
          url: '/v1/web/code',
          body: { email: other.email, locale: 'tr', binding, remember },
          ip: firstTime,
        })
      ).statusCode,
    ).toBe(429);
    // (its owner is offered a link of their own)
    const offeredTo = (email: string) =>
      offered.mock.calls.find(([job]) => job.to === email)?.[0].challengeId;
    await vi.waitFor(() => {
      expect(offeredTo(other.email)).toBeDefined();
    });

    // The wrong-code ceiling full is offered the same, while codes still go out.
    const third = await person(test);
    const thirdAddress = Buffer.from(emailLookupKey(lookup, third.email)).toString('hex');
    await redis.set(`rl:web-fail-a:${thirdAddress}`, String(WEB_LIMITS.failuresPerAddressDay), {
      EX: 3600,
    });
    expect((await askCode(third.email, binding)).statusCode).toBe(202);
    await vi.waitFor(() => {
      expect(offeredTo(third.email)).toBeDefined();
    });
    // The pending link goes with the account.
    expect(
      await redis.sIsMember(`web-of:${third.userId}`, `web-unlock:${offeredTo(third.email) ?? ''}`),
    ).toBe(1);
    expect(await redis.ttl(`web-of:${third.userId}`)).toBeGreaterThan(3600);
    offered.mockRestore();
    await redis.del([`web-unlock-sent:${address}`, `web-unlock-sent:${thirdAddress}`]);

    // The email could not be queued: the day's one is not spent, the next request tries again
    // (QA 6b K2b-1).
    const fourth = await person(test);
    const fourthAddress = await fill(fourth.email);
    const failing = vi
      .spyOn(jobs, 'enqueueWebUnlock')
      .mockRejectedValueOnce(new Error('queue down'));
    expect((await askCode(fourth.email, binding)).statusCode).toBe(429);
    await vi.waitFor(async () => {
      expect(failing).toHaveBeenCalledTimes(1);
      expect(await redis.exists(`web-unlock-sent:${fourthAddress}`)).toBe(0);
    });
    expect((await askCode(fourth.email, binding, ELSEWHERE)).statusCode).toBe(429);
    await vi.waitFor(() => {
      expect(failing).toHaveBeenCalledTimes(2);
    });
    expect(await redis.exists(`web-unlock-sent:${fourthAddress}`)).toBe(1);
    failing.mockRestore();
    await redis.del(`web-unlock-sent:${fourthAddress}`);
  });

  it('counts an IPv6 /48 as one network: many /64s of it are not many networks (QA 4 K2a)', async () => {
    const someone = await person(test);
    const binding = newBinding();
    const ask = (ip: string) =>
      call(test.app, {
        url: '/v1/web/code',
        body: { email: someone.email, locale: 'tr', binding },
        ip,
      });
    for (let i = 0; i < WEB_LIMITS.requestsPerNetworkDay; i += 1) {
      expect((await ask(`2001:db8:77:${String(i + 1)}::1`)).statusCode).toBe(202);
    }
    expect((await ask('2001:db8:77:ff::1')).statusCode).toBe(429);
    expect((await ask('2001:db8:78:1::1')).statusCode).toBe(202);
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
    // It parses as the browser gets it (its words and patterns are inside a template string).
    expect(() => new Script(script.body)).not.toThrow();
    expect(script.body).toContain('([0-9a-f-]{36})\\.([A-Za-z0-9_-]{43})');
    // An unknown session does nothing.
    expect((await revoke(toBase64url(new Uint8Array(32)))).statusCode).toBe(401);
  });
});
