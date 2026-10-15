import {
  GUARDIAN_END_AFTER_MS,
  type GuardianCode,
  type GuardianEnd,
  type GuardianLink,
  type GuardianView,
  type Invite,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventsService } from '../../src/events/events.service.js';
import { GuardianSweeper } from '../../src/guardians/guardian-sweeper.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, createCircle, type Person, person } from './support/people.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const teenager = () => person(test, 'Deniz', '15-17');
const adult = (name = 'Ayşe') => person(test, name);

const codeOf = async (child: Person) =>
  (await as(test, child, 'POST', '/v1/guardians/code')).json<GuardianCode>();
const accept = (parent: Person, code: GuardianCode) =>
  as(test, parent, 'POST', '/v1/guardians/accept', { token: code.token });
const linksOf = async (who: Person) =>
  (await as(test, who, 'GET', '/v1/guardians')).json<{ links: GuardianLink[] }>().links;

/** A parent and a child linked as the app does it: code, the parent's yes, the child's yes. */
async function linked(child: Person, parent: Person): Promise<GuardianLink> {
  const taken = (await accept(parent, await codeOf(child))).json<GuardianLink>();
  const confirmed = await as(test, child, 'POST', `/v1/guardians/${taken.id}/confirm`);
  return confirmed.json<GuardianLink>();
}

describe('guardian links (docs/ADR/0023 §4)', () => {
  it('link a parent and a child by mutual approval, and show both the same, without location', async () => {
    const [child, parent, friend] = await Promise.all([teenager(), adult(), adult('Bora')]);
    // The child is in a group (by code: nobody finds them by username).
    const group = await createCircle(test, friend, 'Okul');
    const groupCode = (
      await as(test, friend, 'POST', '/v1/invites', { kind: 'circle', circleId: group.id })
    ).json<Invite>();
    await as(test, child, 'POST', '/v1/invites/accept', { token: groupCode.token });

    const code = await codeOf(child);
    expect(code.link).toBe(`bargu://g/${code.token}`);
    expect(code.expiresAt).toBeGreaterThan(Date.now());
    const preview = await as(test, parent, 'POST', '/v1/guardians/preview', { token: code.token });
    expect(preview.json()).toEqual({
      child: { username: child.username, displayName: 'Deniz', avatar: null },
    });

    const taken = (await accept(parent, code)).json<GuardianLink>();
    expect(taken).toMatchObject({ role: 'guardian', status: 'confirming', activeAt: null });
    expect(taken.other.username).toBe(child.username);
    // Waiting for the child's yes: nothing to see yet.
    expect((await as(test, parent, 'GET', `/v1/guardians/${taken.id}`)).statusCode).toBe(404);
    const waiting = await linksOf(child);
    expect(waiting).toMatchObject([{ id: taken.id, role: 'child', status: 'confirming' }]);
    expect(waiting[0]?.other.username).toBe(parent.username);

    const active = (
      await as(test, child, 'POST', `/v1/guardians/${taken.id}/confirm`)
    ).json<GuardianLink>();
    expect(active.status).toBe('active');

    const parents = (
      await as(test, parent, 'GET', `/v1/guardians/${taken.id}`)
    ).json<GuardianView>();
    expect(parents).toMatchObject({
      child: { username: child.username },
      ageBand: '15-17',
      circles: [{ kind: 'family', name: 'Okul', members: [{ username: friend.username }] }],
    });
    const childs = (await as(test, child, 'GET', `/v1/guardians/${taken.id}`)).json<GuardianView>();
    expect(childs.circles).toEqual(parents.circles);
    expect(childs.link.role).toBe('child');
    const body = JSON.stringify(parents);
    for (const word of ['envelope', 'lat', 'lng', 'userId', 'email']) {
      expect(body).not.toContain(word);
    }
  });

  it('take a code only from 15-17, by 18+, once, at most two parents', async () => {
    const [child, parent, second, third, other] = await Promise.all([
      teenager(),
      adult(),
      adult('Cem'),
      adult('Ece'),
      teenager(),
    ]);
    const refused = await as(test, parent, 'POST', '/v1/guardians/code');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'GUARDIAN_CHILD_ONLY' });

    const code = await codeOf(child);
    for (const attempt of [
      as(test, other, 'POST', '/v1/guardians/preview', { token: code.token }),
      accept(other, code),
    ]) {
      const response = await attempt;
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ code: 'GUARDIAN_ADULT_ONLY' });
    }
    expect((await accept(parent, code)).statusCode).toBe(200);
    // A code works once; a parent links once.
    expect((await accept(second, code)).json()).toMatchObject({ code: 'INVITE_INVALID' });
    const again = await accept(parent, await codeOf(child));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ code: 'ALREADY_GUARDIAN' });
    expect((await accept(second, await codeOf(child))).statusCode).toBe(200);
    const full = await as(test, child, 'POST', '/v1/guardians/code');
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: 'GUARDIAN_LIMIT' });
    expect(await linksOf(third)).toEqual([]);

    // A code ten minutes old does not work.
    const late = await codeOf(other);
    await test.admin.query(
      `UPDATE app.guardian_links SET code_expires_at = now() - interval '1 second'
        WHERE child_id = $1`,
      [other.userId],
    );
    expect((await accept(third, late)).json()).toMatchObject({ code: 'INVITE_INVALID' });
  });

  it('are nobody else’s to see or change', async () => {
    const [child, parent, stranger] = await Promise.all([teenager(), adult(), adult('Fikret')]);
    const link = await linked(child, parent);
    for (const [method, path] of [
      ['GET', `/v1/guardians/${link.id}`],
      ['POST', `/v1/guardians/${link.id}/confirm`],
      ['POST', `/v1/guardians/${link.id}/end`],
    ] as const) {
      expect((await as(test, stranger, method, path)).statusCode).toBe(404);
    }
    expect(await linksOf(stranger)).toEqual([]);
    // Only the child says the last yes.
    const another = await adult('Gül');
    const pending = (await accept(another, await codeOf(child))).json<GuardianLink>();
    expect((await as(test, parent, 'POST', `/v1/guardians/${pending.id}/confirm`)).statusCode).toBe(
      404,
    );
  });

  it('end at once by the parent; by the child when the parent agrees or a week later', async () => {
    const [child, parent] = await Promise.all([teenager(), adult()]);
    const first = await linked(child, parent);
    const ended = await as(test, parent, 'POST', `/v1/guardians/${first.id}/end`);
    expect(ended.json<GuardianEnd>()).toEqual({ ended: true, endsAt: null });
    expect(await linksOf(child)).toEqual([]);

    const second = await linked(child, parent);
    const asked = (
      await as(test, child, 'POST', `/v1/guardians/${second.id}/end`)
    ).json<GuardianEnd>();
    expect(asked.ended).toBe(false);
    expect(asked.endsAt).toBeGreaterThan(Date.now() + GUARDIAN_END_AFTER_MS - 60_000);
    const [seen] = await linksOf(parent);
    expect(seen?.endRequestedAt).not.toBeNull();
    // The parent agrees.
    expect(
      (await as(test, parent, 'POST', `/v1/guardians/${second.id}/end`)).json<GuardianEnd>().ended,
    ).toBe(true);

    // Or a week passes.
    const third = await linked(child, parent);
    await as(test, child, 'POST', `/v1/guardians/${third.id}/end`);
    await test.admin.query(
      `UPDATE app.guardian_links SET end_requested_at = now() - interval '8 days' WHERE id = $1`,
      [third.id],
    );
    const sweeper = new GuardianSweeper(
      test.app.get(DatabaseService),
      test.app.get(EventsService),
      test.app.get<RedisClient>(REDIS),
    );
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    expect(await linksOf(parent)).toEqual([]);
  });

  it('end when the child is no longer 15-17, the parent no longer 18+, or an account goes', async () => {
    const [child, parent] = await Promise.all([teenager(), adult()]);
    await linked(child, parent);
    await test.admin.query(`UPDATE app.users SET age_band = '18+' WHERE id = $1`, [child.userId]);
    expect(await linksOf(parent)).toEqual([]);

    const [teen, mother] = await Promise.all([teenager(), adult()]);
    await linked(teen, mother);
    await as(test, mother, 'PUT', '/v1/me/age', { band: '15-17' });
    expect(await linksOf(teen)).toEqual([]);

    const [kid, father] = await Promise.all([teenager(), adult()]);
    await linked(kid, father);
    expect((await as(test, father, 'POST', '/v1/me/delete', { confirm: true })).statusCode).toBe(
      204,
    );
    expect(await linksOf(kid)).toEqual([]);
  });
});

describe('"Kullanıcı adımla bulunabilirim" (docs/ADR/0023, QA 5a Y2)', () => {
  it('is on for 18+ until turned off, and off for 15-17 for good', async () => {
    const [someone, looking, teen] = await Promise.all([adult('Hale'), adult(), teenager()]);
    expect((await as(test, someone, 'GET', '/v1/me/findable')).json()).toEqual({
      findable: true,
      locked: false,
    });
    await as(test, someone, 'PUT', '/v1/me/findable', { findable: false });
    expect(
      (await as(test, looking, 'GET', `/v1/profiles?username=${someone.username}`)).statusCode,
    ).toBe(404);
    expect(
      (await as(test, looking, 'POST', '/v1/friends', { username: someone.username })).statusCode,
    ).toBe(404);
    // A name taken but not found says only that: an adult who turned it off looks the same.
    const taken = await as(
      test,
      looking,
      'GET',
      `/v1/usernames/availability?username=${someone.username}`,
    );
    expect(taken.json()).toMatchObject({ available: false, reason: 'taken' });
    await as(test, someone, 'PUT', '/v1/me/findable', { findable: true });
    expect(
      (await as(test, looking, 'GET', `/v1/profiles?username=${someone.username}`)).statusCode,
    ).toBe(200);

    expect((await as(test, teen, 'GET', '/v1/me/findable')).json()).toEqual({
      findable: false,
      locked: true,
    });
    const refused = await as(test, teen, 'PUT', '/v1/me/findable', { findable: true });
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'AGE_RESTRICTED' });
    // Becoming 15-17 turns it off.
    await as(test, someone, 'PUT', '/v1/me/age', { band: '15-17' });
    expect((await as(test, someone, 'GET', '/v1/me/findable')).json()).toEqual({
      findable: false,
      locked: true,
    });
  });
});
