import type { Circle, Invite } from '@bargu/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../../src/infra/database/database.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const HOUR = 3600_000;

const setRole = (by: Person, circleId: string, userId: string, role: string) =>
  as(test, by, 'POST', `/v1/circles/${circleId}/members/${userId}/role`, { role });

const roleOf = (circle: Circle, who: Person) =>
  circle.members.find((member) => member.userId === who.userId)?.role;

const linkFor = (who: Person, circleId: string) =>
  as(test, who, 'POST', '/v1/invites', { kind: 'circle', circleId });

const join = (who: Person, invite: Invite) =>
  as(test, who, 'POST', '/v1/invites/accept', { token: invite.token });

describe('circle admins (docs/ADR/0020)', () => {
  it('make others admin and take it back from each other, never from the creator', async () => {
    const [founder, bora, can, dila, stranger] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    const circle = await circleWith(test, founder, bora, can, dila);

    const made = await setRole(founder, circle.id, bora.userId, 'owner');
    expect(made.statusCode).toBe(200);
    expect(roleOf(made.json<Circle>(), bora)).toBe('owner');
    // A new admin makes another one, and takes it back again; keys stay as they are.
    expect((await setRole(bora, circle.id, can.userId, 'owner')).statusCode).toBe(200);
    const back = await setRole(bora, circle.id, can.userId, 'member');
    expect(roleOf(back.json<Circle>(), can)).toBe('member');
    expect(back.json<Circle>().epoch).toBe(circle.epoch);

    // A member makes nobody admin; nobody takes it from the creator, nor from themselves.
    expect((await setRole(can, circle.id, dila.userId, 'owner')).statusCode).toBe(403);
    const creator = await setRole(bora, circle.id, founder.userId, 'member');
    expect(creator.statusCode).toBe(403);
    expect(creator.json()).toMatchObject({ code: 'CREATOR_ADMIN' });
    expect((await setRole(bora, circle.id, bora.userId, 'member')).statusCode).toBe(403);

    // The database holds the rules too: nobody makes themselves admin by an update, and the
    // creator keeps the role whoever asks.
    const database = test.app.get(DatabaseService);
    await expect(
      database.asUser(dila.userId, (tx) =>
        tx.execute(
          sql`UPDATE app.circle_members SET role = 'owner'
               WHERE circle_id = ${circle.id} AND user_id = ${dila.userId}`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.asUser(bora.userId, (tx) =>
        tx.execute(
          sql`UPDATE app.circle_members SET role = 'member'
               WHERE circle_id = ${circle.id} AND user_id = ${founder.userId}`,
        ),
      ),
    ).rejects.toThrow();

    // The creator takes it back from Bora, who can then make nobody admin.
    expect((await setRole(founder, circle.id, bora.userId, 'member')).statusCode).toBe(200);
    expect((await setRole(bora, circle.id, dila.userId, 'owner')).statusCode).toBe(403);

    // Outside the circle it does not exist; someone not in it cannot be made admin.
    expect((await setRole(stranger, circle.id, dila.userId, 'owner')).statusCode).toBe(404);
    expect((await setRole(founder, circle.id, stranger.userId, 'owner')).statusCode).toBe(404);
    expect((await setRole(founder, circle.id, dila.userId, 'boss')).statusCode).toBe(400);
  });

  it('answer the same when someone accepts again: a retried request changes nothing (B2)', async () => {
    const [owner, bora, can, dila] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    // A group's single-use link.
    const group = await circleWith(test, owner);
    const link = (await linkFor(owner, group.id)).json<Invite>();
    expect((await join(bora, link)).json()).toEqual({ circleId: group.id });
    const epoch = (await as(test, owner, 'GET', `/v1/circles/${group.id}`)).json<Circle>().epoch;
    expect((await join(bora, link)).json()).toEqual({ circleId: group.id });
    expect((await join(can, link)).statusCode).toBe(404);
    expect((await as(test, owner, 'GET', `/v1/circles/${group.id}`)).json<Circle>().epoch).toBe(
      epoch,
    );

    // A friend code.
    const code = (await as(test, owner, 'POST', '/v1/invites', { kind: 'friend' })).json<Invite>();
    const first = await join(dila, code);
    expect(first.statusCode).toBe(200);
    expect((await join(dila, code)).json()).toEqual(first.json());

    // An invitation by name.
    await as(test, owner, 'POST', `/v1/circles/${group.id}/members`, { username: can.username });
    const accepted = await as(test, can, 'POST', `/v1/circles/${group.id}/accept`);
    expect(accepted.statusCode).toBe(200);
    const twice = await as(test, can, 'POST', `/v1/circles/${group.id}/accept`);
    expect(twice.statusCode).toBe(200);
    expect(twice.json<Circle>().epoch).toBe(accepted.json<Circle>().epoch);
    // Someone never invited still gets nothing.
    const stranger = await person(test);
    expect((await as(test, stranger, 'POST', `/v1/circles/${group.id}/accept`)).statusCode).toBe(
      404,
    );
  });

  it('are fixed in a pair: both stay owners', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const pair = (
      await as(test, ayse, 'POST', '/v1/friends', { username: bora.username })
    ).json<Circle>();
    await as(test, bora, 'POST', `/v1/circles/${pair.id}/accept`);
    expect((await setRole(ayse, pair.id, bora.userId, 'member')).statusCode).toBe(403);
  });

  it('alone let people into an event; in a group everyone invites', async () => {
    const [owner, bora, guest, late] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    const event = (
      await as(test, owner, 'POST', '/v1/circles', {
        kind: 'event',
        name: 'Konser',
        endsAt: Date.now() + 3 * HOUR,
      })
    ).json<Circle>();
    expect((await join(bora, (await linkFor(owner, event.id)).json<Invite>())).statusCode).toBe(
      200,
    );

    // Bora is a member: no QR code, no invitation by name.
    expect((await linkFor(bora, event.id)).statusCode).toBe(403);
    const byName = await as(test, bora, 'POST', `/v1/circles/${event.id}/members`, {
      username: guest.username,
    });
    expect(byName.statusCode).toBe(403);

    // Made admin, Bora shows a QR code; once no longer an admin, it stops working.
    expect((await setRole(owner, event.id, bora.userId, 'owner')).statusCode).toBe(200);
    const boras = await linkFor(bora, event.id);
    expect(boras.statusCode).toBe(201);
    expect((await join(guest, boras.json<Invite>())).statusCode).toBe(200);
    expect((await setRole(owner, event.id, bora.userId, 'member')).statusCode).toBe(200);
    expect((await join(late, boras.json<Invite>())).statusCode).toBe(404);

    // In a family circle every member invites, as before.
    const family = await circleWith(test, owner, bora);
    expect((await linkFor(bora, family.id)).statusCode).toBe(201);
  });
});
