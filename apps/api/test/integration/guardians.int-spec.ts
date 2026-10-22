import {
  type Circle,
  GUARDIAN_END_AFTER_MS,
  type GuardianCode,
  type GuardianEnd,
  type GuardianLink,
  type GuardianView,
  type Invite,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { inviteHostOf } from '../../src/config/env.js';
import { EventsService } from '../../src/events/events.service.js';
import { GuardianSweeper } from '../../src/guardians/guardian-sweeper.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { Notifier } from '../../src/push/notifier.js';
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
    expect(code.link).toBe(`https://${inviteHostOf(test.env)}/g#${code.token}`);
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
      circles: [{ kind: 'family', name: 'Okul', members: [{ displayName: 'Bora' }] }],
    });
    const childs = (await as(test, child, 'GET', `/v1/guardians/${taken.id}`)).json<GuardianView>();
    expect(childs.circles).toEqual(parents.circles);
    expect(childs.link.role).toBe('child');
    const body = JSON.stringify(parents);
    for (const word of ['envelope', 'lat', 'lng', 'userId', 'email']) {
      expect(body).not.toContain(word);
    }
    // Display names only: a parent cannot look the friend up (QA 5b G-1).
    expect(JSON.stringify(parents.circles)).not.toContain(friend.username);
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

describe('guardian tools (docs/ADR/0023 §5)', () => {
  const viewOf = async (who: Person, link: GuardianLink) =>
    (await as(test, who, 'GET', `/v1/guardians/${link.id}`)).json<GuardianView>();
  const codeFrom = async (who: Person, body: object) =>
    (await as(test, who, 'POST', '/v1/invites', body)).json<Invite>();
  const join = (who: Person, invite: Invite) =>
    as(test, who, 'POST', '/v1/invites/accept', { token: invite.token });
  const answer = (parent: Person, link: GuardianLink, requestId: string, yes: boolean) =>
    as(
      test,
      parent,
      'POST',
      `/v1/guardians/${link.id}/requests/${requestId}/${yes ? 'approve' : 'decline'}`,
    );

  it('make a new person wait for a parent’s yes, and the yes does it as the child', async () => {
    const [child, parent, friend, stranger] = await Promise.all([
      teenager(),
      adult(),
      adult('Bora'),
      adult('Fikret'),
    ]);
    const link = await linked(child, parent);
    const friendCode = await codeFrom(friend, { kind: 'friend' });
    const waiting = await join(child, friendCode);
    expect(waiting.statusCode).toBe(403);
    expect(waiting.json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    expect((await join(child, friendCode)).statusCode).toBe(403);
    const asked = await viewOf(parent, link);
    expect(asked.requests).toMatchObject([{ kind: 'friend', name: 'Bora', by: 'Bora' }]);
    expect(JSON.stringify(asked.requests)).not.toContain(friend.username);
    expect((await viewOf(child, link)).requests).toEqual(asked.requests);
    const [request] = asked.requests;
    if (request === undefined) throw new Error('no request');

    // Nobody else answers: not the child, not a stranger.
    expect((await answer(child, link, request.id, true)).statusCode).toBe(404);
    expect((await answer(stranger, link, request.id, true)).statusCode).toBe(404);
    expect((await answer(parent, link, request.id, true)).json()).toEqual({ done: true });
    const circles = (await as(test, child, 'GET', '/v1/circles')).json<{ circles: Circle[] }>();
    expect(circles.circles.some((circle) => circle.kind === 'pair')).toBe(true);
    expect((await viewOf(parent, link)).requests).toEqual([]);

    // A group: no.
    const group = await createCircle(test, stranger, 'Kulüp');
    const groupCode = await codeFrom(stranger, { kind: 'circle', circleId: group.id });
    expect((await join(child, groupCode)).statusCode).toBe(403);
    const [groupRequest] = (await viewOf(parent, link)).requests;
    expect(groupRequest).toMatchObject({ kind: 'group', name: 'Kulüp', by: 'Fikret' });
    expect((await answer(parent, link, groupRequest?.id ?? '', false)).json()).toEqual({
      done: false,
    });
    expect((await as(test, child, 'GET', `/v1/circles/${group.id}`)).statusCode).toBe(404);

    // By username, too.
    expect(
      (await as(test, child, 'POST', '/v1/friends', { username: stranger.username })).json(),
    ).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    const [byName] = (await viewOf(parent, link)).requests;
    expect(byName).toMatchObject({ kind: 'friend', name: 'Fikret', by: null });

    // A code that stopped working meanwhile: the yes says so.
    const late = await codeFrom(friend, {
      kind: 'circle',
      circleId: (await createCircle(test, friend)).id,
    });
    expect((await join(child, late)).statusCode).toBe(403);
    await as(test, friend, 'POST', `/v1/invites/${late.id}/revoke`);
    const gone = (await viewOf(parent, link)).requests.find((r) => r.kind === 'gone');
    expect(gone).toBeDefined();
    expect((await answer(parent, link, gone?.id ?? '', true)).json()).toMatchObject({
      code: 'REQUEST_FAILED',
    });
  });

  it('make someone coming to the child wait as well: the child’s codes and invitations (QA 5c F-2)', async () => {
    const [child, parent, ali, bora, cem] = await Promise.all([
      teenager(),
      adult(),
      adult('Ali'),
      adult('Bora'),
      adult('Cem'),
    ]);
    const link = await linked(child, parent);
    const group = await createCircle(test, child, 'Sınıf');
    const childsCode = await codeFrom(child, { kind: 'circle', circleId: group.id });

    // With the child's group code: waits, and says only that.
    const waiting = await join(ali, childsCode);
    expect(waiting.statusCode).toBe(403);
    expect(waiting.json()).toMatchObject({ code: 'APPROVAL_PENDING' });
    expect(JSON.stringify(waiting.json())).not.toMatch(/guardian|age|15/i);
    const [joins] = (await viewOf(parent, link)).requests;
    expect(joins).toMatchObject({ kind: 'joins', name: 'Sınıf', by: 'Ali' });
    expect((await answer(parent, link, joins?.id ?? '', true)).json()).toEqual({ done: true });
    expect((await as(test, ali, 'GET', `/v1/circles/${group.id}`)).statusCode).toBe(200);

    // With the child's friend code: no.
    const friendCode = await codeFrom(child, { kind: 'friend' });
    expect((await join(bora, friendCode)).json()).toMatchObject({ code: 'APPROVAL_PENDING' });
    const [befriends] = (await viewOf(parent, link)).requests;
    expect(befriends).toMatchObject({ kind: 'befriends', by: 'Bora' });
    await answer(parent, link, befriends?.id ?? '', false);
    const boras = (await as(test, bora, 'GET', '/v1/circles')).json<{ circles: Circle[] }>();
    expect(boras.circles.some((circle) => circle.kind === 'pair')).toBe(false);

    // The child invites by username: waits, then the invitation goes out.
    const invited = await as(test, child, 'POST', `/v1/circles/${group.id}/members`, {
      username: cem.username,
    });
    expect(invited.json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    const [invites] = (await viewOf(parent, link)).requests;
    expect(invites).toMatchObject({ kind: 'invites', name: 'Sınıf', by: 'Cem' });
    await answer(parent, link, invites?.id ?? '', true);
    const cems = (await as(test, cem, 'GET', `/v1/circles/${group.id}`)).json<Circle>();
    expect(cems.myStatus).toBe('invited');

    // The child's own parent comes in at once.
    const forParent = await codeFrom(child, { kind: 'circle', circleId: group.id });
    expect((await join(parent, forParent)).statusCode).toBe(200);
    expect(JSON.stringify((await viewOf(parent, link)).requests)).not.toContain('username');
  });

  it('tell the parents when someone new comes into a group the child is in (QA 5c F-2)', async () => {
    const [child, parent, ayse, bora] = await Promise.all([
      teenager(),
      adult(),
      adult('Ayşe'),
      adult('Bora'),
    ]);
    const link = await linked(child, parent);
    const group = await createCircle(test, ayse, 'Takım');
    // The child comes in with a parent's yes.
    expect(
      (await join(child, await codeFrom(ayse, { kind: 'circle', circleId: group.id }))).statusCode,
    ).toBe(403);
    const [asked] = (await viewOf(parent, link)).requests;
    await answer(parent, link, asked?.id ?? '', true);

    // Someone else's code: not held (the circle never learns a 15-17 is in it), the parent hears it.
    const notify = vi.spyOn(test.app.get(Notifier), 'notify');
    const response = await join(bora, await codeFrom(ayse, { kind: 'circle', circleId: group.id }));
    expect(response.statusCode).toBe(200);
    expect(notify).toHaveBeenCalledWith([parent.userId], 'guardianNewMember', link.id);
    const [circle] = (await viewOf(parent, link)).circles;
    expect(circle?.members).toContainEqual({ displayName: 'Bora', isNew: true });

    // With the yes for new people off, nobody is told.
    await as(test, parent, 'PUT', `/v1/guardians/${link.id}/settings`, {
      approveNewPeople: false,
      dailyLimitMinutes: null,
    });
    notify.mockClear();
    const cem = await adult('Cem');
    await join(cem, await codeFrom(ayse, { kind: 'circle', circleId: group.id }));
    expect(notify.mock.calls.some((call) => call[1] === 'guardianNewMember')).toBe(false);
    notify.mockRestore();
  });

  it('keep requests within bounds and tell a parent once per request (QA 5b/5c S-3)', async () => {
    const [child, parent, stranger] = await Promise.all([teenager(), adult(), adult('Fikret')]);
    await linked(child, parent);
    const notify = vi.spyOn(test.app.get(Notifier), 'notify');
    const code = await codeFrom(stranger, { kind: 'friend' });
    expect((await join(child, code)).statusCode).toBe(403);
    expect((await join(child, code)).statusCode).toBe(403);
    expect(notify.mock.calls.filter((call) => call[1] === 'guardianApproval')).toHaveLength(1);

    // At most 20 waiting for a child: then asked to wait.
    await test.admin.query(
      "INSERT INTO app.guardian_requests (child_id, kind, username) SELECT $1, 'friend', 'x' || g FROM generate_series(1, 19) g",
      [child.userId],
    );
    const full = await join(child, await codeFrom(stranger, { kind: 'friend' }));
    expect(full.statusCode).toBe(429);

    // At most 5 waiting for one newcomer, across every child.
    const [other, otherParent, newcomer] = await Promise.all([teenager(), adult(), adult('Nur')]);
    await linked(other, otherParent);
    await test.admin.query(
      "INSERT INTO app.guardian_requests (child_id, kind, token_hash, newcomer_id) SELECT $1, 'admit', sha256(g::text::bytea), $2 FROM generate_series(1, 5) g",
      [other.userId, newcomer.userId],
    );
    const crowded = await join(newcomer, await codeFrom(other, { kind: 'friend' }));
    expect(crowded.statusCode).toBe(429);

    // A parent gets at most 30 of these an hour, however many accounts cause them.
    const redis = test.app.get<RedisClient>(REDIS);
    await redis.set(`rl:guardian-notices:${otherParent.userId}`, '30', { EX: 3600 });
    notify.mockClear();
    expect((await join(other, await codeFrom(stranger, { kind: 'friend' }))).statusCode).toBe(403);
    expect(notify.mock.calls.some((call) => call[1] === 'guardianApproval')).toBe(false);
    notify.mockRestore();
  });

  it('are set by a parent only, read by the child, and the same on both sides', async () => {
    const [child, parent, other] = await Promise.all([teenager(), adult(), adult('Gül')]);
    const link = await linked(child, parent);
    expect((await as(test, child, 'GET', '/v1/guardians/rules')).json()).toEqual({
      linked: true,
      settings: { approveNewPeople: true, dailyLimitMinutes: null },
    });
    const set = await as(test, parent, 'PUT', `/v1/guardians/${link.id}/settings`, {
      approveNewPeople: false,
      dailyLimitMinutes: 60,
    });
    expect(set.json<GuardianView>().settings).toMatchObject({
      approveNewPeople: false,
      dailyLimitMinutes: 60,
      updatedBy: parent.username,
    });
    expect((await as(test, child, 'GET', '/v1/guardians/rules')).json()).toEqual({
      linked: true,
      settings: { approveNewPeople: false, dailyLimitMinutes: 60 },
    });
    expect((await viewOf(child, link)).settings).toEqual((await viewOf(parent, link)).settings);
    // No yes needed now: the child comes in at once.
    const code = await codeFrom(other, { kind: 'friend' });
    expect((await join(child, code)).statusCode).toBe(200);
    // Only a parent, and only within bounds.
    for (const [who, body, status] of [
      [child, { approveNewPeople: true, dailyLimitMinutes: null }, 404],
      [other, { approveNewPeople: true, dailyLimitMinutes: null }, 404],
      [parent, { approveNewPeople: true, dailyLimitMinutes: 10 }, 400],
      [parent, { approveNewPeople: true, dailyLimitMinutes: 400 }, 400],
    ] as const) {
      expect(
        (await as(test, who, 'PUT', `/v1/guardians/${link.id}/settings`, body)).statusCode,
      ).toBe(status);
    }
    expect((await as(test, other, 'GET', '/v1/guardians/rules')).json()).toEqual({
      linked: false,
      settings: null,
    });
  });

  it('keep the minutes only while a parent is linked, for 7 days, and forget them with the link', async () => {
    const [child, parent] = await Promise.all([teenager(), adult()]);
    const { rows } = await test.admin.query<{ today: string; old: string }>(
      `SELECT to_char(current_date, 'YYYY-MM-DD') AS today,
              to_char(current_date - 10, 'YYYY-MM-DD') AS old`,
    );
    const { today, old } = rows[0] ?? { today: '', old: '' };
    const report = (who: Person, day: string, minutes: number) =>
      as(test, who, 'PUT', '/v1/guardians/usage', { day, minutes });

    expect((await report(child, today, 15)).statusCode).toBe(204);
    const link = await linked(child, parent);
    expect((await viewOf(parent, link)).usage).toEqual([]);
    await report(child, today, 42);
    await report(child, old, 99);
    expect((await viewOf(parent, link)).usage).toEqual([{ day: today, minutes: 42 }]);
    expect((await viewOf(child, link)).usage).toEqual([{ day: today, minutes: 42 }]);
    expect((await report(child, today, 2000)).statusCode).toBe(400);
    // A day that does not exist is a bad request, not a server error (QA 5c F-3).
    expect((await report(child, '2026-13-45', 5)).statusCode).toBe(400);

    await as(test, parent, 'POST', `/v1/guardians/${link.id}/end`);
    const left = await test.admin.query(
      `SELECT 1 FROM app.usage_days WHERE child_id = $1
       UNION ALL SELECT 1 FROM app.guardian_settings WHERE child_id = $1`,
      [child.userId],
    );
    expect(left.rows).toEqual([]);
  });
});
