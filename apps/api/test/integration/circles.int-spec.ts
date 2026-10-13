import type { Circle, Invite, InvitePreview } from '@bargu/schemas';
import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../../src/infra/database/database.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, createCircle, person } from './support/people.js';

let test: TestApp;
let pool: Pool;
let database: DatabaseService;

beforeAll(async () => {
  test = await createTestApp();
  pool = new Pool({ connectionString: test.env.DATABASE_URL, max: 2 });
  database = new DatabaseService(pool);
});
afterAll(async () => {
  await pool.end();
  await test.close();
});

const listOf = async (who: Parameters<typeof as>[1]) =>
  (await as(test, who, 'GET', '/v1/circles')).json<{ circles: Circle[] }>().circles;

describe('circles', () => {
  it('belong to their members only (Faz 4 DoD: no access for anyone else)', async () => {
    const [owner, stranger] = await Promise.all([person(test), person(test)]);
    const circle = await createCircle(test, owner, 'Ailem');
    expect(circle).toMatchObject({ kind: 'family', name: 'Ailem', myRole: 'owner', epoch: 1 });

    expect((await as(test, stranger, 'GET', `/v1/circles/${circle.id}`)).statusCode).toBe(404);
    expect(await listOf(stranger)).toEqual([]);
    for (const attempt of [
      as(test, stranger, 'PATCH', `/v1/circles/${circle.id}`, { name: 'Ele geçti' }),
      as(test, stranger, 'POST', `/v1/circles/${circle.id}/accept`),
      as(test, stranger, 'POST', `/v1/circles/${circle.id}/leave`),
      as(test, stranger, 'GET', `/v1/circles/${circle.id}/keys`),
      as(test, stranger, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id }),
    ]) {
      expect((await attempt).statusCode).toBe(404);
    }
  });

  it('hide every row from someone outside, even when queried directly', async () => {
    const [owner, member, stranger] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, member);
    await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id });
    await database.asUser(stranger.userId, async (tx) => {
      for (const table of ['circles', 'circle_members', 'invites', 'key_envelopes']) {
        const result = await tx.execute<{ n: number }>(
          sql.raw(
            `SELECT count(*)::int AS n FROM app.${table} WHERE ${table === 'circles' ? 'id' : 'circle_id'} = '${circle.id}'`,
          ),
        );
        expect(result.rows[0], table).toEqual({ n: 0 });
      }
      const cards = await tx.execute(sql`SELECT * FROM app.circle_member_cards(${circle.id})`);
      expect(cards.rows).toEqual([]);
    });
  });

  it('cannot be joined without an invitation, and a removed member cannot let themselves back in', async () => {
    const [owner, member, outsider] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, member);
    await expect(
      database.asUser(outsider.userId, (tx) =>
        tx.execute(
          sql`INSERT INTO app.circle_members (circle_id, user_id, role, status) VALUES (${circle.id}, ${outsider.userId}, 'member', 'active')`,
        ),
      ),
    ).rejects.toThrow();

    expect(
      (await as(test, owner, 'POST', `/v1/circles/${circle.id}/members/${member.userId}/remove`))
        .statusCode,
    ).toBe(200);
    await expect(
      database.asUser(member.userId, (tx) =>
        tx.execute(
          sql`UPDATE app.circle_members SET status = 'active' WHERE circle_id = ${circle.id} AND user_id = ${member.userId}`,
        ),
      ),
    ).rejects.toThrow();
    expect((await as(test, member, 'GET', `/v1/circles/${circle.id}`)).statusCode).toBe(404);
  });

  it('start a new key epoch on every membership change', async () => {
    const [owner, a, b] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, a, b);
    // Created at 1, two members joined.
    expect(circle.epoch).toBe(3);
    await as(test, a, 'POST', `/v1/circles/${circle.id}/leave`);
    const afterLeave = (await as(test, owner, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(afterLeave.epoch).toBe(4);
    expect(afterLeave.members.map((m) => m.userId).sort()).toEqual([owner.userId, b.userId].sort());
    const removed = (
      await as(test, owner, 'POST', `/v1/circles/${circle.id}/members/${b.userId}/remove`)
    ).json<Circle>();
    expect(removed.epoch).toBe(5);
  });

  it('show members their profile and the active device keys, never other data', async () => {
    const [owner, member] = await Promise.all([person(test, 'Ayşe'), person(test, 'Bora')]);
    const circle = await circleWith(test, owner, member);
    const seen = circle.members.find((m) => m.userId === member.userId);
    expect(seen).toMatchObject({
      status: 'active',
      username: member.username,
      displayName: 'Bora',
      device: { platform: 'android', bundle: { deviceId: member.device.deviceId } },
    });
    expect(Object.keys(seen ?? {}).sort()).toEqual(
      ['avatar', 'device', 'displayName', 'role', 'status', 'userId', 'username'].sort(),
    );
  });

  it('hand ownership to the longest-standing member when the owner leaves', async () => {
    const [owner, first, second] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, first, second);
    await as(test, owner, 'POST', `/v1/circles/${circle.id}/leave`);
    const after = (await as(test, second, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(after.members.find((m) => m.role === 'owner')?.userId).toBe(first.userId);
  });

  it('withdraw open invitations when the last active member leaves (never a group without an owner)', async () => {
    const [owner, invitee] = await Promise.all([person(test), person(test)]);
    const circle = await createCircle(test, owner);
    await as(test, owner, 'POST', `/v1/circles/${circle.id}/members`, {
      username: invitee.username,
    });
    await as(test, owner, 'POST', `/v1/circles/${circle.id}/leave`);
    expect((await listOf(invitee)).some((c) => c.id === circle.id)).toBe(false);
    expect((await as(test, invitee, 'POST', `/v1/circles/${circle.id}/accept`)).statusCode).toBe(
      404,
    );
  });

  it('take a former owner back as a member only', async () => {
    const [owner, heir] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, owner, heir);
    await as(test, owner, 'POST', `/v1/circles/${circle.id}/leave`);
    const link = (
      await as(test, heir, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
    ).json<Invite>();
    await as(test, owner, 'POST', '/v1/invites/accept', { token: link.token });
    const back = (await as(test, owner, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(back.myRole).toBe('member');
    expect(
      (await as(test, owner, 'POST', `/v1/circles/${circle.id}/members/${heir.userId}/remove`))
        .statusCode,
    ).toBe(403);
  });

  it('show someone invited only who invited them, until they accept', async () => {
    const [owner, member, invitee] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, member);
    await as(test, owner, 'POST', `/v1/circles/${circle.id}/members`, {
      username: invitee.username,
    });
    const seen = (await as(test, invitee, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(seen.members.map((m) => m.userId).sort()).toEqual([owner.userId, invitee.userId].sort());
    await as(test, invitee, 'POST', `/v1/circles/${circle.id}/accept`);
    const joined = (await as(test, invitee, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(joined.members).toHaveLength(3);
  });

  it('stay within 50 people even when two links are used at the same moment', async () => {
    const [owner, first, second] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await createCircle(test, owner);
    // 48 more active members (made directly; the limit is what is under test, not the invites).
    await test.admin.query(
      `WITH made AS (
         INSERT INTO app.users (id, email_hmac)
         SELECT uuidv7(), sha256(gen_random_uuid()::text::bytea) FROM generate_series(1, 48)
         RETURNING id)
       INSERT INTO app.circle_members (circle_id, user_id, role, status, joined_at)
       SELECT $1, id, 'member', 'active', now() FROM made`,
      [circle.id],
    );
    const links = await Promise.all(
      [0, 1].map(async () =>
        (
          await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
        ).json<Invite>(),
      ),
    );
    const results = await Promise.all([
      as(test, first, 'POST', '/v1/invites/accept', { token: links[0]?.token }),
      as(test, second, 'POST', '/v1/invites/accept', { token: links[1]?.token }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    const { rows } = await test.admin.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM app.circle_members WHERE circle_id = $1 AND status = 'active'`,
      [circle.id],
    );
    expect(rows[0]?.n).toBe(50);
  });

  it('cannot be forged in the database: no hand-made pairs, no epoch changes, no peeking', async () => {
    const [owner, member, stranger] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, member);
    // A pair circle only comes from a request or a friend code (squatting the pair key fails).
    await expect(
      database.asUser(stranger.userId, (tx) =>
        tx.execute(
          sql`INSERT INTO app.circles (kind, pair_key, created_by) VALUES ('pair', ${`${owner.userId}:${member.userId}`}, ${stranger.userId})`,
        ),
      ),
    ).rejects.toThrow();
    await expect(
      database.asUser(stranger.userId, (tx) =>
        tx.execute(
          sql`INSERT INTO app.circles (kind, name, created_by, epoch) VALUES ('family', 'X', ${stranger.userId}, 99)`,
        ),
      ),
    ).rejects.toThrow();
    // Members cannot rewind (or push) the epoch: only app.start_epoch moves it, by one.
    await expect(
      database.asUser(member.userId, (tx) =>
        tx.execute(sql`UPDATE app.circles SET epoch = 1 WHERE id = ${circle.id}`),
      ),
    ).rejects.toThrow();
    await database.asUser(stranger.userId, async (tx) => {
      const probe = await tx.execute<{ active: boolean; empty: boolean }>(
        sql`SELECT app.is_active_member(${circle.id}, ${member.userId}) AS active,
                   app.circle_is_empty(${circle.id}) AS empty`,
      );
      // Nothing to learn about a circle one is not in.
      expect(probe.rows[0]).toEqual({ active: false, empty: false });
    });
    await expect(
      database.asUser(stranger.userId, (tx) =>
        tx.execute(sql`SELECT app.start_epoch(${circle.id})`),
      ),
    ).rejects.toThrow();
    // A member cannot touch the owner's row at all.
    const removal = await database.asUser(member.userId, (tx) =>
      tx.execute(
        sql`UPDATE app.circle_members SET status = 'removed' WHERE circle_id = ${circle.id} AND user_id = ${owner.userId}`,
      ),
    );
    expect(removal.rowCount).toBe(0);
    // Nor can another owner (both people of a friendship are owners).
    const pair = (
      await as(test, owner, 'POST', '/v1/friends', { username: member.username })
    ).json<Circle>();
    await as(test, member, 'POST', `/v1/circles/${pair.id}/accept`);
    await expect(
      database.asUser(member.userId, (tx) =>
        tx.execute(
          sql`UPDATE app.circle_members SET status = 'removed' WHERE circle_id = ${pair.id} AND user_id = ${owner.userId}`,
        ),
      ),
    ).rejects.toThrow();
  });

  it('let only owners rename and remove', async () => {
    const [owner, member, other] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, owner, member, other);
    expect(
      (await as(test, member, 'PATCH', `/v1/circles/${circle.id}`, { name: 'X' })).statusCode,
    ).toBe(403);
    expect(
      (await as(test, member, 'POST', `/v1/circles/${circle.id}/members/${other.userId}/remove`))
        .statusCode,
    ).toBe(403);
    const renamed = await as(test, owner, 'PATCH', `/v1/circles/${circle.id}`, {
      name: 'Kuzenler',
    });
    expect(renamed.json<Circle>().name).toBe('Kuzenler');
  });
});

describe('friends', () => {
  it('need both sides: a request by username, then the other accepts', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    const requested = await as(test, ali, 'POST', '/v1/friends', {
      username: `@${veli.username.toUpperCase()}`,
    });
    expect(requested.statusCode).toBe(200);
    const pair = requested.json<Circle>();
    expect(pair).toMatchObject({ kind: 'pair', name: null, myStatus: 'active' });

    const incoming = (await listOf(veli)).find((c) => c.id === pair.id);
    expect(incoming).toMatchObject({ myStatus: 'invited' });
    // Nothing is shared before acceptance: no device keys of the invitee are handed out.
    expect(pair.members.find((m) => m.userId === veli.userId)?.device).toBeNull();

    const accepted = (await as(test, veli, 'POST', `/v1/circles/${pair.id}/accept`)).json<Circle>();
    expect(accepted.members.every((m) => m.status === 'active')).toBe(true);
    // The same two people never get a second pair circle.
    const again = await as(test, veli, 'POST', '/v1/friends', { username: ali.username });
    expect(again.json<Circle>().id).toBe(pair.id);
  });

  it('disappear for both sides when declined or ended', async () => {
    const [ali, veli, can] = await Promise.all([person(test), person(test), person(test)]);
    const declined = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    await as(test, veli, 'POST', `/v1/circles/${declined.id}/decline`);
    expect((await listOf(ali)).some((c) => c.id === declined.id)).toBe(false);
    expect((await listOf(veli)).some((c) => c.id === declined.id)).toBe(false);

    const ended = (
      await as(test, ali, 'POST', '/v1/friends', { username: can.username })
    ).json<Circle>();
    await as(test, can, 'POST', `/v1/circles/${ended.id}/accept`);
    await as(test, can, 'POST', `/v1/circles/${ended.id}/leave`);
    expect((await listOf(ali)).some((c) => c.id === ended.id)).toBe(false);
  });

  it('end for both sides, and coming back needs a new yes from the other', async () => {
    const [can, ali] = await Promise.all([person(test), person(test)]);
    const pair = (
      await as(test, ali, 'POST', '/v1/friends', { username: can.username })
    ).json<Circle>();
    await as(test, can, 'POST', `/v1/circles/${pair.id}/accept`);
    await as(test, can, 'POST', `/v1/circles/${pair.id}/leave`);

    // Can asks again: Ali is asked, not silently made a friend again.
    const again = (
      await as(test, can, 'POST', '/v1/friends', { username: ali.username })
    ).json<Circle>();
    expect(again.id).toBe(pair.id);
    expect(again.members.find((m) => m.userId === ali.userId)).toMatchObject({
      status: 'invited',
      device: null,
    });
    expect((await listOf(ali)).find((c) => c.id === pair.id)?.myStatus).toBe('invited');
  });

  it('turn two requests into a friendship (asking back is saying yes)', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    const asked = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    const back = (
      await as(test, veli, 'POST', '/v1/friends', { username: ali.username })
    ).json<Circle>();
    expect(back.members.map((m) => m.status)).toEqual(['active', 'active']);
    expect(back.epoch).toBeGreaterThan(asked.epoch);
  });

  it('do not come back by themselves after a decline', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    const asked = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    await as(test, veli, 'POST', `/v1/circles/${asked.id}/decline`);
    const later = (
      await as(test, veli, 'POST', '/v1/friends', { username: ali.username })
    ).json<Circle>();
    expect(later.members.find((m) => m.userId === ali.userId)?.status).toBe('invited');
  });

  it('answer the same for unknown names and yourself', async () => {
    const ali = await person(test);
    for (const username of ['nobody_here_123', ali.username]) {
      expect((await as(test, ali, 'POST', '/v1/friends', { username })).statusCode).toBe(404);
    }
  });

  it('show a public card by username: name and avatar, no ids', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test, 'Veli')]);
    const card = await as(test, ali, 'GET', `/v1/profiles?username=${veli.username}`);
    expect(card.json()).toEqual({ username: veli.username, displayName: 'Veli', avatar: null });
  });
});

describe('invite links', () => {
  it('work once (Faz 4 DoD), even when two people try at the same moment', async () => {
    const [owner, first, second] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await createCircle(test, owner);
    const invite = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
    ).json<Invite>();
    expect(invite.link).toBe(`bargu://i/${invite.token}`);

    const results = await Promise.all(
      [first, second].map((who) =>
        as(test, who, 'POST', '/v1/invites/accept', { token: invite.token }),
      ),
    );
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 404]);
    const third = await person(test);
    const late = await as(test, third, 'POST', '/v1/invites/accept', { token: invite.token });
    expect(late.json()).toMatchObject({ code: 'INVITE_INVALID' });
  });

  it('preview who invites to what, without ids, and stop working once revoked', async () => {
    const [owner, guest] = await Promise.all([person(test, 'Ayşe'), person(test)]);
    const circle = await createCircle(test, owner, 'Kampçılar');
    const invite = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
    ).json<Invite>();
    const preview = (
      await as(test, guest, 'POST', '/v1/invites/preview', { token: invite.token })
    ).json<InvitePreview>();
    expect(preview).toEqual({
      kind: 'circle',
      inviter: { username: owner.username, displayName: 'Ayşe', avatar: null },
      circle: { name: 'Kampçılar', kind: 'family', memberCount: 1 },
    });
    await as(test, owner, 'POST', `/v1/invites/${invite.id}/revoke`);
    expect(
      (await as(test, guest, 'POST', '/v1/invites/preview', { token: invite.token })).statusCode,
    ).toBe(404);
    expect(
      (await as(test, guest, 'POST', '/v1/invites/accept', { token: invite.token })).statusCode,
    ).toBe(404);
  });

  it('expire', async () => {
    const [owner, guest] = await Promise.all([person(test), person(test)]);
    const invite = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'friend' })
    ).json<Invite>();
    await test.admin.query(
      `UPDATE app.invites SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [invite.id],
    );
    expect(
      (await as(test, guest, 'POST', '/v1/invites/accept', { token: invite.token })).statusCode,
    ).toBe(404);
  });

  it('make a friend from a QR code: both sides active at once', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    const invite = (await as(test, ali, 'POST', '/v1/invites', { kind: 'friend' })).json<Invite>();
    expect(
      (await as(test, ali, 'POST', '/v1/invites/accept', { token: invite.token })).statusCode,
    ).toBe(404);
    const accepted = await as(test, veli, 'POST', '/v1/invites/accept', { token: invite.token });
    const { circleId } = accepted.json<{ circleId: string }>();
    const pair = (await as(test, ali, 'GET', `/v1/circles/${circleId}`)).json<Circle>();
    expect(pair.kind).toBe('pair');
    expect(pair.members.map((m) => m.status)).toEqual(['active', 'active']);
  });

  it('made before a friendship ended no longer work', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    const oldCode = (await as(test, ali, 'POST', '/v1/invites', { kind: 'friend' })).json<Invite>();
    const pair = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    await as(test, veli, 'POST', `/v1/circles/${pair.id}/accept`);
    await as(test, ali, 'POST', `/v1/circles/${pair.id}/leave`);
    const used = await as(test, veli, 'POST', '/v1/invites/accept', { token: oldCode.token });
    expect(used.statusCode).toBe(404);
    expect(used.json()).toMatchObject({ code: 'INVITE_INVALID' });
    expect((await listOf(ali)).some((c) => c.id === pair.id)).toBe(false);
  });

  it('keep the token out of the database (only its hash)', async () => {
    const owner = await person(test);
    const invite = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'friend' })
    ).json<Invite>();
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(i)::text AS dump FROM app.invites i WHERE id = $1`,
      [invite.id],
    );
    expect(rows[0]?.dump).not.toContain(invite.token);
  });
});
