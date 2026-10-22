import { type AgeState, type Circle, type Invite, type PrivacyState } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './support/app.js';
import {
  call,
  codeFor,
  newDevice,
  registration,
  requestCode,
  uniqueEmail,
} from './support/client.js';
import { as, consentToHistory, createCircle, type Person, person } from './support/people.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const ageOf = async (who: Person) =>
  (await as(test, who, 'GET', '/v1/me/age')).json<AgeState>().age;

async function friends(a: Person, b: Person): Promise<Circle> {
  const asked = await as(test, a, 'POST', '/v1/friends', { username: b.username });
  const pair = asked.json<Circle>();
  await as(test, b, 'POST', `/v1/circles/${pair.id}/accept`);
  return pair;
}

async function createEvent(owner: Person): Promise<Circle> {
  const response = await as(test, owner, 'POST', '/v1/circles', {
    kind: 'event',
    name: 'Konser',
    endsAt: Date.now() + 3 * 3600_000,
  });
  return response.json<Circle>();
}

const codeOf = async (who: Person, circle: Circle) =>
  (
    await as(test, who, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
  ).json<Invite>();

const join = (who: Person, invite: Invite) =>
  as(test, who, 'POST', '/v1/invites/accept', { token: invite.token });

describe('the age band (docs/ADR/0023)', () => {
  it('comes with a new account and is kept as a band only; an account cannot open without it', async () => {
    const device = newDevice();
    const email = uniqueEmail();
    const { challengeId } = await requestCode(test, email, device);
    const refused = await call(test.app, {
      url: '/v1/auth/otp/verify',
      body: { challengeId, code: codeFor(test, challengeId), device: registration(device) },
      device,
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json()).toMatchObject({ code: 'AGE_REQUIRED' });
    // Asked again without it, more often than a code has tries: not counted as tries (QA 6a Y1b).
    for (let again = 0; again < 3; again += 1) {
      const without = await call(test.app, {
        url: '/v1/auth/otp/verify',
        body: { challengeId, code: codeFor(test, challengeId), device: registration(device) },
        device,
      });
      expect(without.json()).toMatchObject({ code: 'AGE_REQUIRED' });
    }
    // The same code still works with the band (QA 5a Y1).
    const opened = await call(test.app, {
      url: '/v1/auth/otp/verify',
      body: {
        challengeId,
        code: codeFor(test, challengeId),
        device: registration(device),
        ageBand: '18+',
      },
      device,
    });
    expect(opened.statusCode).toBe(200);

    const teen = await person(test, 'Deniz', '15-17');
    expect(await ageOf(teen)).toMatchObject({ band: '15-17', method: 'declared' });
    const { rows: stored } = await test.admin.query<Record<string, unknown>>(
      `SELECT * FROM app.users WHERE id = $1`,
      [teen.userId],
    );
    expect(Object.keys(stored[0] ?? {}).filter((key) => key.startsWith('age'))).toEqual([
      'age_band',
      'age_method',
      'age_set_at',
    ]);
  });

  it('is said once by an account that never did; older than said takes a person', async () => {
    const someone = await person(test);
    await test.admin.query(
      `UPDATE app.users SET age_band = NULL, age_method = NULL, age_set_at = NULL WHERE id = $1`,
      [someone.userId],
    );
    expect(await ageOf(someone)).toBeNull();
    const said = await as(test, someone, 'PUT', '/v1/me/age', { band: '18+' });
    expect(said.json<AgeState>().age).toMatchObject({ band: '18+', method: 'declared' });
    // Younger is always allowed; older back is not, by saying so.
    expect((await as(test, someone, 'PUT', '/v1/me/age', { band: '15-17' })).statusCode).toBe(200);
    const older = await as(test, someone, 'PUT', '/v1/me/age', { band: '18+' });
    expect(older.statusCode).toBe(403);
    expect(older.json()).toMatchObject({ code: 'AGE_REVIEW_REQUIRED' });
    expect((await as(test, someone, 'PUT', '/v1/me/age', { band: '14' })).statusCode).toBe(400);
    expect((await call(test.app, { method: 'GET', url: '/v1/me/age' })).statusCode).toBe(401);
  });

  it('is shown to nobody else: not in circles, not in profiles', async () => {
    const [teen, adult] = await Promise.all([person(test, 'Deniz', '15-17'), person(test)]);
    const pair = await friends(teen, adult);
    const seen = await as(test, adult, 'GET', `/v1/circles/${pair.id}`);
    expect(seen.body).not.toContain('15-17');
    // No field about age at any depth. Not a search for the letters "age" in the whole body: the
    // members' keys are random base64 and once in a while hold them (CI run 39782089816).
    const fieldsOf = (value: unknown): string[] =>
      value !== null && typeof value === 'object'
        ? Object.entries(value).flatMap(([field, inner]) => [field, ...fieldsOf(inner)])
        : [];
    expect(fieldsOf(seen.json()).filter((field) => /^age|ageband|band$/i.test(field))).toEqual([]);
  });
});

describe('15-17 (docs/ADR/0023)', () => {
  it('is not found by username, but finds others and is added with a code', async () => {
    const [teen, adult] = await Promise.all([person(test, 'Deniz', '15-17'), person(test)]);
    const profile = await as(test, adult, 'GET', `/v1/profiles?username=${teen.username}`);
    expect(profile.statusCode).toBe(404);
    expect(
      (await as(test, adult, 'POST', '/v1/friends', { username: teen.username })).statusCode,
    ).toBe(404);
    const group = await createCircle(test, adult);
    const invited = await as(test, adult, 'POST', `/v1/circles/${group.id}/members`, {
      username: teen.username,
    });
    expect(invited.statusCode).toBe(404);
    // The other way, and with a code, it works.
    expect(
      (await as(test, teen, 'GET', `/v1/profiles?username=${adult.username}`)).statusCode,
    ).toBe(200);
    expect((await join(teen, await codeOf(adult, group))).statusCode).toBe(200);
    const pair = await friends(teen, adult);
    expect(pair.kind).toBe('pair');
  });

  it('gets no location history: no consent taken, and becoming 15-17 ends it', async () => {
    const teen = await person(test, 'Deniz', '15-17');
    const refused = await as(test, teen, 'PUT', '/v1/me/privacy/history', {
      given: true,
      version: 1,
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'AGE_RESTRICTED' });

    const [adult, host] = await Promise.all([person(test), person(test)]);
    await consentToHistory(test, adult);
    // An invitation by username from before stays no longer (QA 5c, old invitations).
    const group = await createCircle(test, host);
    await as(test, host, 'POST', `/v1/circles/${group.id}/members`, { username: adult.username });
    await as(test, adult, 'PUT', '/v1/me/age', { band: '15-17' });
    const privacy = (await as(test, adult, 'GET', '/v1/me/privacy')).json<PrivacyState>();
    expect(privacy.history).toBeNull();
    expect((await as(test, adult, 'GET', `/v1/circles/${group.id}`)).statusCode).toBe(404);
  });

  it('comes into an event only with a friend’s code; groups and friends as anyone', async () => {
    const [teen, organiser, friend] = await Promise.all([
      person(test, 'Deniz', '15-17'),
      person(test),
      person(test),
    ]);
    const event = await createEvent(organiser);
    const strangers = await join(teen, await codeOf(organiser, event));
    expect(strangers.statusCode).toBe(403);
    expect(strangers.json()).toMatchObject({ code: 'FRIEND_INVITE_ONLY' });
    // The refused code is not used up: an adult still comes in with it.
    const code = await codeOf(organiser, event);
    expect((await join(teen, code)).statusCode).toBe(403);
    expect((await join(friend, code)).statusCode).toBe(200);
    // The same code works once the organiser is a friend (an event's codes come from its admins).
    await friends(teen, organiser);
    expect((await join(teen, code)).statusCode).toBe(200);
    // A friend code from someone met there works too (a friendship needs the teen's own yes).
    const friendCode = (
      await as(test, friend, 'POST', '/v1/invites', { kind: 'friend' })
    ).json<Invite>();
    expect((await join(teen, friendCode)).statusCode).toBe(200);
  });
});
