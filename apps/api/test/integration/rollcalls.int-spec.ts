import { encryptChat, generateSenderKey, randomUuid } from '@bargu/crypto';
import {
  type ChatPayload,
  type Circle,
  COMMUNITY_RULES_VERSION,
  type Invite,
  ROLLCALL,
  type RollcallReply,
  type RollcallView,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { EmailJobs } from '../../src/jobs/email-jobs.js';
import { MessagesSweeper } from '../../src/messages/messages-sweeper.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;
let owner: Person;
let ali: Person;
let ece: Person;
let stranger: Person;

beforeAll(async () => {
  test = await createTestApp();
  [owner, ali, ece, stranger] = await Promise.all([
    person(test, 'Sahip'),
    person(test, 'Ali'),
    person(test, 'Ece'),
    person(test, 'Yabancı'),
  ]);
});
afterAll(async () => {
  await test.close();
});

const HOUR = 3_600_000;

async function eventWith(...members: Person[]): Promise<Circle> {
  const created = await as(test, owner, 'POST', '/v1/circles', {
    kind: 'event',
    name: 'Gezi',
    endsAt: Date.now() + 3 * HOUR,
  });
  if (created.statusCode !== 201) throw new Error(`create event: ${created.body}`);
  const circle = created.json<Circle>();
  const qr = (
    await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
  ).json<Invite>();
  for (const member of members) {
    const joined = await as(test, member, 'POST', '/v1/invites/accept', { token: qr.token });
    if (joined.statusCode !== 200) throw new Error(`join: ${joined.body}`);
  }
  return (await as(test, owner, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
}

/** A small item of `who` for the circle, sealed with their chat key for its epoch. */
function item(who: Person, circle: Pick<Circle, 'id' | 'epoch'>, payload: ChatPayload) {
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  return encryptChat({ senderKey, sender: who.device, payload });
}

const ask = (who: Person, circle: Circle, id = randomUuid()) => {
  const envelope = item(who, circle, {
    kind: 'rollcall',
    id,
    closesAt: Date.now() + ROLLCALL.openMs,
    ts: Date.now(),
  });
  return as(test, who, 'POST', `/v1/circles/${circle.id}/rollcalls`, { envelope }).then(
    (response) => response.json<RollcallReply>(),
  );
};
const here = (who: Person, circle: Circle, rollcallId: string) => {
  const envelope = item(who, circle, {
    kind: 'here',
    id: randomUuid(),
    rollcallId,
    ts: Date.now(),
  });
  return as(test, who, 'POST', `/v1/circles/${circle.id}/rollcalls/${rollcallId}/answer`, {
    envelope,
  }).then((response) => response.json<RollcallReply>());
};
const close = (who: Person, circle: Circle, rollcallId: string) =>
  as(test, who, 'POST', `/v1/circles/${circle.id}/rollcalls/${rollcallId}/close`).then((response) =>
    response.json<RollcallReply>(),
  );
const current = async (who: Person, circle: Circle) =>
  (await as(test, who, 'GET', `/v1/circles/${circle.id}/rollcalls/current`)).json<RollcallView>()
    .rollcall;
const idOf = (reply: RollcallReply) => ('ok' in reply ? reply.rollcall.id : '');

describe('an event roll call (docs/ADR/0040)', () => {
  it('is asked by an event owner only, one at a time, and answered once by who may', async () => {
    const event = await eventWith(ali, ece);
    // A member and a stranger cannot ask.
    expect(await ask(ali, event)).toEqual({ refused: 'NOT_OWNER' });
    expect(await ask(stranger, event)).toEqual({ refused: 'NOT_ELIGIBLE' });

    const started = await ask(owner, event);
    expect(started).toMatchObject({ ok: true });
    const id = idOf(started);
    if (!('ok' in started)) throw new Error('not started');
    expect(new Set(started.rollcall.eligible)).toEqual(new Set([ali.userId, ece.userId]));
    expect(started.rollcall.outCount).toBe(0);
    expect(started.rollcall.closesAt - started.rollcall.startedAt).toBe(ROLLCALL.openMs);
    // One open at a time.
    expect(await ask(owner, event)).toEqual({ refused: 'ALREADY_OPEN' });

    // "Buradayım": once; a second answer does not replace the first.
    const first = await here(ali, event, id);
    expect(first).toMatchObject({ ok: true });
    const firstAt = 'ok' in first ? first.rollcall.answers[0]?.at : 0;
    await here(ali, event, id);
    const seen = await current(owner, event);
    expect(seen?.answers.map((answer) => [answer.userId, answer.at])).toEqual([
      [ali.userId, firstAt],
    ]);
    // The owner is not one who answers; a stranger cannot answer or see it.
    expect(await here(owner, event, id)).toEqual({ refused: 'NOT_ELIGIBLE' });
    expect(await here(stranger, event, id)).toEqual({ refused: 'NOT_ELIGIBLE' });
    expect(await current(stranger, event)).toBeNull();

    // "Bitir": only an owner, and then nobody answers.
    expect(await close(ali, event, id)).toEqual({ refused: 'NOT_OWNER' });
    expect(await close(owner, event, id)).toMatchObject({ ok: true });
    expect(await here(ece, event, id)).toEqual({ refused: 'CLOSED' });
    expect((await current(ece, event))?.closedAt).not.toBeNull();

    // Its id again, here or in another event: a refusal, not a server error (QA-44 Düşük 5).
    expect(await ask(owner, event, id)).toEqual({ refused: 'INVALID' });
    expect(await ask(owner, await eventWith(ali), id)).toEqual({ refused: 'INVALID' });
  });

  it('is never asked outside an event', async () => {
    const group = await circleWith(test, owner, ali);
    expect(await ask(owner, group)).toEqual({ refused: 'NOT_EVENT' });
  });

  it('is asked at most six times an hour in a circle', async () => {
    const event = await eventWith(ali);
    for (let round = 0; round < ROLLCALL.perHour; round += 1) {
      const started = await ask(owner, event);
      expect(started).toMatchObject({ ok: true });
      await close(owner, event, idOf(started));
    }
    expect(await ask(owner, event)).toEqual({ refused: 'RATE_LIMITED' });
  });

  it('leaves out who turned roll calls off, saying only how many', async () => {
    const event = await eventWith(ali, ece);
    expect((await as(test, ece, 'PUT', '/v1/me/rollcalls', { on: false })).statusCode).toBe(200);
    try {
      const started = await ask(owner, event);
      if (!('ok' in started)) throw new Error('not started');
      expect(started.rollcall.eligible).toEqual([ali.userId]);
      expect(started.rollcall.outCount).toBe(1);
      // Left out, Ece neither sees it nor answers it.
      expect(await current(ece, event)).toBeNull();
      expect(await here(ece, event, started.rollcall.id)).toEqual({ refused: 'NOT_ELIGIBLE' });
    } finally {
      await as(test, ece, 'PUT', '/v1/me/rollcalls', { on: true });
    }
  });

  it('lets 15–17 take part only in events of at most eight people (the PM)', async () => {
    const teen = await person(test, 'Genç');
    await as(test, teen, 'PUT', '/v1/me/age', { band: '18+' });
    const others = await Promise.all(
      Array.from({ length: ROLLCALL.teenMaxMembers }, (_, n) => person(test, `Üye${String(n)}`)),
    );
    for (const who of [teen, ...others]) {
      await as(test, who, 'PUT', '/v1/me/rules', { version: COMMUNITY_RULES_VERSION });
    }
    // Eight people with the owner: the teen takes part.
    const small = await eventWith(teen, ...others.slice(0, ROLLCALL.teenMaxMembers - 2));
    // Ten: the teen does not.
    const large = await eventWith(teen, ...others);
    expect((await as(test, teen, 'PUT', '/v1/me/age', { band: '15-17' })).statusCode).toBe(200);

    const inSmall = await ask(owner, small);
    if (!('ok' in inSmall)) throw new Error('not started');
    expect(inSmall.rollcall.eligible).toContain(teen.userId);
    const inLarge = await ask(owner, large);
    if (!('ok' in inLarge)) throw new Error('not started');
    expect(inLarge.rollcall.eligible).not.toContain(teen.userId);
    expect(inLarge.rollcall.outCount).toBe(1);
    expect(await current(teen, large)).toBeNull();
  });

  it('is deleted 24 hours after it began, with its answers', async () => {
    const event = await eventWith(ali);
    const started = await ask(owner, event);
    const id = idOf(started);
    await here(ali, event, id);
    await test.admin.query(
      `UPDATE app.rollcalls SET started_at = now() - interval '25 hours',
         closes_at = now() - interval '24 hours' WHERE id = $1`,
      [id],
    );
    const sweeper = new MessagesSweeper(
      test.app.get(DatabaseService),
      test.app.get<RedisClient>(REDIS),
      test.app.get(EmailJobs),
      test.env,
    );
    await sweeper.sweep();
    const left = await test.admin.query(
      `SELECT (SELECT count(*) FROM app.rollcalls WHERE id = $1) AS calls,
              (SELECT count(*) FROM app.rollcall_answers WHERE rollcall_id = $1) AS answers`,
      [id],
    );
    expect(left.rows[0]).toEqual({ calls: '0', answers: '0' });
  });
});
