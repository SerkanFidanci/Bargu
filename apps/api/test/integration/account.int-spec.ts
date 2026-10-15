import {
  createSenderState,
  deriveWebCode,
  encryptHistory,
  generateSenderKey,
  toBase64url,
} from '@bargu/crypto';
import {
  type AccountExport,
  type Circle,
  HISTORY_SLOT_MS,
  historySlot,
  type PrivacyState,
  type WebChallenge,
  type WebSession,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EXPORT_PER_HOUR } from '../../src/account/account.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login } from './support/client.js';
import { dumpEverything } from './support/dump.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const deleteAccount = (who: Person, confirm = true) =>
  as(test, who, 'POST', '/v1/me/delete', { confirm });

/** A piece of location history for a circle, sealed by `who`'s phone. */
function trailOf(who: Person, circle: Circle) {
  const state = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  const slot = historySlot(Date.now()) - HISTORY_SLOT_MS;
  const { envelope } = encryptHistory({
    state,
    sender: who.device,
    payload: { kind: 'trail', from: slot, points: [[0, 4_100_000, 2_900_000, 9]], ts: slot },
  });
  return { slot, envelope };
}

describe('deleting an account (docs/ADR/0022)', () => {
  it('leaves its circles as leaving does, closes its phone, and leaves nothing of it behind', async () => {
    const [leaver, member, friend] = await Promise.all([person(test), person(test), person(test)]);
    const group = await circleWith(test, leaver, member);
    const asked = await as(test, leaver, 'POST', '/v1/friends', { username: friend.username });
    const pair = asked.json<Circle>();
    await as(test, friend, 'POST', `/v1/circles/${pair.id}/accept`);
    await as(test, leaver, 'PUT', '/v1/me/privacy/notice', { version: 1 });

    expect((await deleteAccount(leaver, false)).statusCode).toBe(400);
    expect((await deleteAccount(leaver)).statusCode).toBe(204);

    // The group goes on with the other member as its admin, under new keys.
    const after = (await as(test, member, 'GET', `/v1/circles/${group.id}`)).json<Circle>();
    expect(after.members.map((m) => [m.userId, m.role])).toEqual([[member.userId, 'owner']]);
    expect(after.epoch).toBeGreaterThan(group.epoch);
    // The friendship is over for the friend too.
    expect((await as(test, friend, 'GET', `/v1/circles/${pair.id}`)).statusCode).toBe(404);
    // The phone is out.
    expect(
      (
        await call(test.app, {
          method: 'GET',
          url: '/v1/me',
          accessToken: leaver.session.accessToken,
        })
      ).statusCode,
    ).toBe(401);
    // Purged at once: no row, no key, no queued job names the account.
    const left = await dumpEverything(test);
    const at = left.indexOf(leaver.userId);
    expect(at === -1 ? '' : left.slice(Math.max(0, at - 300), at + 60)).toBe('');
    // The address can open a new account.
    expect((await login(test, leaver.email)).session.userId).not.toBe(leaver.userId);
  });

  it('can be asked for on the account web page with the emailed code', async () => {
    const someone = await person(test);
    const binding = toBase64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
    const ip = '198.51.100.21';
    const { challengeId } = (
      await call(test.app, {
        url: '/v1/web/code',
        body: { email: someone.email, locale: 'tr', binding },
        ip,
      })
    ).json<WebChallenge>();
    const session = (
      await call(test.app, {
        url: '/v1/web/verify',
        body: { challengeId, code: deriveWebCode(test.env.OTP_KEY, challengeId), binding },
        ip,
      })
    ).json<WebSession>();
    const deleted = await call(test.app, {
      url: '/v1/web/delete-account',
      body: { token: session.token },
      ip,
    });
    expect(deleted.json()).toEqual({ deleted: true });
    expect(
      (await call(test.app, { url: '/v1/web/delete-account', body: { token: session.token }, ip }))
        .statusCode,
    ).toBe(401);
    expect(await dumpEverything(test)).not.toContain(someone.userId);
  });
});

describe('the copy of an account (docs/ADR/0022)', () => {
  it('gives its owner what the server holds of them, and nothing of anyone else', async () => {
    const [owner, other] = await Promise.all([person(test, 'Ayşe'), person(test, 'Bora')]);
    const group = await circleWith(test, owner, other);
    const copy = await as(test, owner, 'GET', '/v1/me/export');
    expect(copy.statusCode).toBe(200);
    const data = copy.json<AccountExport>();
    expect(data.account).toMatchObject({ userId: owner.userId, username: owner.username });
    expect(data.devices).toHaveLength(1);
    expect(data.circles.map((circle) => [circle.id, circle.role])).toEqual([[group.id, 'owner']]);
    expect(data.securityEvents.map((event) => event.type)).toContain('login_otp');
    expect(JSON.stringify(data)).not.toContain(other.userId);
    // Nobody else's, and not without signing in.
    expect((await call(test.app, { method: 'GET', url: '/v1/me/export' })).statusCode).toBe(401);
    for (let i = 1; i < EXPORT_PER_HOUR; i += 1) await as(test, owner, 'GET', '/v1/me/export');
    expect((await as(test, owner, 'GET', '/v1/me/export')).statusCode).toBe(429);
  });
});

describe('KVKK records (docs/ADR/0022)', () => {
  it('keep the notice read and the consent to history, and no history goes in without it', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const state = () => as(test, ayse, 'GET', '/v1/me/privacy');
    expect((await state()).json()).toEqual({ notice: null, history: null });

    const read = await as(test, ayse, 'PUT', '/v1/me/privacy/notice', { version: 1 });
    expect(read.json<PrivacyState>().notice?.version).toBe(1);
    expect((await as(test, ayse, 'PUT', '/v1/me/privacy/notice', { version: 99 })).statusCode).toBe(
      400,
    );

    const piece = trailOf(ayse, circle);
    const upload = () =>
      as(test, ayse, 'PUT', `/v1/circles/${circle.id}/history/${String(piece.slot)}`, {
        envelope: piece.envelope,
      });
    const refused = await upload();
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'CONSENT_REQUIRED' });

    // Consent is for the text shown (its version), then history goes in.
    expect(
      (await as(test, ayse, 'PUT', '/v1/me/privacy/history', { given: true, version: 2 }))
        .statusCode,
    ).toBe(400);
    const given = await as(test, ayse, 'PUT', '/v1/me/privacy/history', {
      given: true,
      version: 1,
    });
    expect(given.json<PrivacyState>().history?.version).toBe(1);
    expect((await upload()).statusCode).toBe(204);

    // Withdrawn: no more.
    const withdrawn = await as(test, ayse, 'PUT', '/v1/me/privacy/history', {
      given: false,
      version: 1,
    });
    expect(withdrawn.json<PrivacyState>().history).toBeNull();
    expect((await upload()).statusCode).toBe(403);
    // Someone else's records are not theirs to read.
    expect((await as(test, bora, 'GET', '/v1/me/privacy')).json()).toEqual({
      notice: null,
      history: null,
    });
  });
});
