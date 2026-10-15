import { randomUuid } from '@bargu/crypto';
import { type Circle, EVENT_DURATION_MS, type Invite } from '@bargu/schemas';
import { Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CIRCLE_LIMITS, EVENT_CLOCK_SKEW_MS } from '../../src/circles/circles.service.js';
import { EventExpiry } from '../../src/circles/event-expiry.js';
import { EventsService } from '../../src/events/events.service.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { RateLimiter } from '../../src/infra/redis/rate-limiter.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { RelayService } from '../../src/relay/relay.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { dumpEverything } from './support/dump.js';
import { as, type Person, person } from './support/people.js';
import { exclusively, SWEEP_TIMEOUT_MS } from './support/sweep.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const HOUR = 3600_000;

async function createEvent(owner: Person, endsAt = Date.now() + 3 * HOUR) {
  return as(test, owner, 'POST', '/v1/circles', { kind: 'event', name: 'Konser', endsAt });
}

/** An event with its owner and one more member. */
async function eventOfTwo(): Promise<{ circle: Circle; owner: Person; ayse: Person }> {
  const [owner, ayse] = await Promise.all([person(test), person(test)]);
  const circle = (await createEvent(owner)).json<Circle>();
  const qr = (
    await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
  ).json<Invite>();
  await as(test, ayse, 'POST', '/v1/invites/accept', { token: qr.token });
  return { circle, owner, ayse };
}

const endOnTime = (circleId: string) =>
  test.admin.query(
    `UPDATE app.circles SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [circleId],
  );

const recordOf = async (circleId: string) =>
  (
    await test.admin.query<{ member_ids: string[] }>(
      `SELECT member_ids FROM app.event_cleanups WHERE circle_id = $1`,
      [circleId],
    )
  ).rows[0];

const sweep = () => test.app.get(EventExpiry).sweep();

/**
 * Redis deletes fail for this circle only, `times` times: another test's leftovers are cleared as
 * usual (each test stands on its own).
 */
function failDeletesOf(circleId: string, times: number) {
  const redis = test.app.get<RedisClient>(REDIS);
  const real = redis.del.bind(redis);
  let left = times;
  return vi.spyOn(redis, 'del').mockImplementation(((keys: string | string[]) => {
    if (left > 0 && JSON.stringify(keys).includes(circleId)) {
      left -= 1;
      return Promise.reject(new Error('redis down'));
    }
    return real(keys);
  }) as typeof redis.del);
}

/** "I am looking at this circle" (a socket message): the relay's answer. */
const watch = (who: Person, circleId: string) =>
  test.app.get(RelayService).watch(
    {
      userId: who.userId,
      deviceId: who.device.deviceId,
      sessionId: randomUuid(),
      identityKey: who.device.identity.publicKey,
      expiresAt: Date.now() + 60_000,
    },
    circleId,
  );

describe('clean-up of ended events (QA Faz 8 C1–C4, kept for good)', () => {
  it(
    'C1: keeps a record of who was in it until the clean-up went through, out of the app’s reach',
    () =>
      exclusively(test, async () => {
        const { circle, owner, ayse } = await eventOfTwo();
        await endOnTime(circle.id);
        const del = failDeletesOf(circle.id, 1);
        await expect(sweep()).rejects.toThrow('redis down');
        del.mockRestore();
        expect((await recordOf(circle.id))?.member_ids.sort()).toEqual(
          [owner.userId, ayse.userId].sort(),
        );
        // The app's own role cannot read it: only the functions can.
        const refused = await test.app
          .get(DatabaseService)
          .db.execute(sql`SELECT * FROM app.event_cleanups`)
          .then(
            () => 'read',
            (error: unknown) =>
              String(error instanceof Error ? (error.cause ?? error.message) : error),
          );
        expect(refused).toMatch(/permission denied/);
        await sweep();
        expect(await recordOf(circle.id)).toBeUndefined();
        expect(await dumpEverything(test)).not.toContain(circle.id);
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'C2a: tries again round after round until it goes through',
    () =>
      exclusively(test, async () => {
        const { circle } = await eventOfTwo();
        await endOnTime(circle.id);
        const del = failDeletesOf(circle.id, 3);
        for (let round = 0; round < 3; round += 1) {
          await expect(sweep()).rejects.toThrow('redis down');
          expect(await recordOf(circle.id)).toBeDefined();
        }
        del.mockRestore();
        await sweep();
        expect(await recordOf(circle.id)).toBeUndefined();
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'C2b: tries again when telling the phones or clearing the streams fails',
    () =>
      exclusively(test, async () => {
        const { circle, owner } = await eventOfTwo();
        await endOnTime(circle.id);
        const events = test.app.get(EventsService);
        const realForget = events.forgetCircle.bind(events);
        const forget = vi
          .spyOn(events, 'forgetCircle')
          .mockImplementation((members, circleId) =>
            circleId === circle.id
              ? Promise.reject(new Error('streams down'))
              : realForget(members, circleId),
          );
        await expect(sweep()).rejects.toThrow('streams down');
        forget.mockRestore();
        expect(await recordOf(circle.id)).toBeDefined();
        const realPublish = events.publish.bind(events);
        const publish = vi
          .spyOn(events, 'publish')
          .mockImplementation((userIds, event) =>
            [...userIds].includes(owner.userId) && event.type === 'circles.reload'
              ? Promise.reject(new Error('events down'))
              : realPublish(userIds, event),
          );
        await expect(sweep()).rejects.toThrow('events down');
        publish.mockRestore();
        expect(await recordOf(circle.id)).toBeDefined();
        await sweep();
        expect(await recordOf(circle.id)).toBeUndefined();
        expect(await dumpEverything(test)).not.toContain(circle.id);
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'C2c: one that keeps failing does not hold the others back, and a stale one is warned about',
    () =>
      exclusively(test, async () => {
        const poison = await eventOfTwo();
        const other = await eventOfTwo();
        await endOnTime(poison.circle.id);
        await endOnTime(other.circle.id);
        const events = test.app.get(EventsService);
        const real = events.forgetCircle.bind(events);
        const forget = vi
          .spyOn(events, 'forgetCircle')
          .mockImplementation(async (members, circleId) =>
            circleId === poison.circle.id
              ? Promise.reject(new Error('poison'))
              : real(members, circleId),
          );
        await expect(sweep()).rejects.toThrow('poison');
        expect(await recordOf(other.circle.id)).toBeUndefined();
        expect(await recordOf(poison.circle.id)).toBeDefined();
        // Waiting for minutes: the worker says so (how many, never which).
        await test.admin.query(
          `UPDATE app.event_cleanups SET created_at = now() - interval '6 minutes' WHERE circle_id = $1`,
          [poison.circle.id],
        );
        const warn = vi.spyOn(Logger.prototype, 'warn');
        await expect(sweep()).rejects.toThrow('poison');
        const said = warn.mock.calls.map((call) => String(call[0]));
        expect(said.some((line) => line.includes('waiting for more than 5 minutes'))).toBe(true);
        expect(said.join(' ')).not.toContain(poison.circle.id);
        warn.mockRestore();
        forget.mockRestore();
        await sweep();
        expect(await recordOf(poison.circle.id)).toBeUndefined();
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'C3: "end now" leaves no trace and no record, takes only its own circle, and is the owner’s',
    () =>
      exclusively(test, async () => {
        const mine = await eventOfTwo();
        const waiting = await eventOfTwo();
        // Another event ended and nobody swept yet: ending mine does not wait for it (QA Faz 8 O1).
        await endOnTime(waiting.circle.id);
        expect(
          (await as(test, mine.ayse, 'POST', `/v1/circles/${mine.circle.id}/end`)).statusCode,
        ).toBe(404);
        expect(
          (await as(test, mine.owner, 'POST', `/v1/circles/${mine.circle.id}/end`)).statusCode,
        ).toBe(204);
        expect(await recordOf(mine.circle.id)).toBeUndefined();
        expect(await dumpEverything(test)).not.toContain(mine.circle.id);
        const left = await test.admin.query(`SELECT 1 FROM app.circles WHERE id = $1`, [
          waiting.circle.id,
        ]);
        expect(left.rows).toHaveLength(1);
        expect(
          (await as(test, mine.owner, 'POST', `/v1/circles/${mine.circle.id}/end`)).statusCode,
        ).toBe(404);

        // With Redis failing: still ended, the record waits for the worker, which finishes it.
        const late = await eventOfTwo();
        const del = failDeletesOf(late.circle.id, 1);
        expect(
          (await as(test, late.owner, 'POST', `/v1/circles/${late.circle.id}/end`)).statusCode,
        ).toBe(204);
        del.mockRestore();
        expect(await recordOf(late.circle.id)).toBeDefined();
        await sweep();
        expect(await recordOf(late.circle.id)).toBeUndefined();
        expect(await dumpEverything(test)).not.toContain(late.circle.id);
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'C4: sweeps running together share the work and leave no trace',
    () =>
      exclusively(test, async () => {
        // Set up one by one (the database pool is shared); only the sweeps run together.
        const events = [];
        for (let i = 0; i < 5; i += 1) events.push(await eventOfTwo());
        for (const { circle } of events) await endOnTime(circle.id);
        const ended = await Promise.all([sweep(), sweep(), sweep()]);
        expect(ended.reduce((sum, count) => sum + count, 0)).toBeGreaterThanOrEqual(5);
        const after = await dumpEverything(test);
        for (const { circle } of events) {
          expect(after).not.toContain(circle.id);
          expect(await recordOf(circle.id)).toBeUndefined();
        }
      }),
    SWEEP_TIMEOUT_MS,
  );
});

describe('the clean-up records in the database (QA Faz 8 M1–M2, kept for good)', () => {
  it('M1: only the definer functions reach the table; the app role runs them, nobody else', async () => {
    const { rows: table } = await test.admin.query<{
      owner: string;
      rls: boolean;
      forced: boolean;
    }>(
      `SELECT pg_get_userbyid(c.relowner) AS owner, c.relrowsecurity AS rls,
              c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relname = 'event_cleanups'`,
    );
    expect(table).toEqual([{ owner: 'bargu_owner', rls: true, forced: true }]);
    const { rows: policies } = await test.admin.query(
      `SELECT 1 FROM pg_policies WHERE schemaname = 'app' AND tablename = 'event_cleanups'`,
    );
    expect(policies).toEqual([]);
    const { rows: access } = await test.admin.query<{ any: boolean }>(
      `SELECT has_table_privilege('bargu_app', 'app.event_cleanups',
                                  'SELECT,INSERT,UPDATE,DELETE') AS any`,
    );
    expect(access[0]?.any).toBe(false);
    for (const fn of [
      'app.expire_event_circles()',
      'app.pending_event_cleanups()',
      'app.finish_event_cleanup(uuid)',
      'app.end_event_now(uuid)',
      'app.stale_event_cleanups()',
    ]) {
      const { rows } = await test.admin.query<{
        definer: boolean;
        app: boolean;
        everyone: boolean;
      }>(
        `SELECT p.prosecdef AS definer,
                has_function_privilege('bargu_app', p.oid, 'EXECUTE') AS app,
                EXISTS (SELECT 1 FROM aclexplode(p.proacl) a
                         WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') AS everyone
           FROM pg_proc p WHERE p.oid = $1::regprocedure`,
        [fn],
      );
      expect({ fn, ...rows[0] }).toEqual({ fn, definer: true, app: true, everyone: false });
    }
  });

  it(
    'M2: an event that ended while nothing swept waits whole, then goes with the next sweep',
    () =>
      exclusively(test, async () => {
        const { circle } = await eventOfTwo();
        await endOnTime(circle.id);
        // Ended, unswept (the worker was down): nothing is lost and nothing recorded yet.
        const { rows } = await test.admin.query(`SELECT 1 FROM app.circles WHERE id = $1`, [
          circle.id,
        ]);
        expect(rows).toHaveLength(1);
        expect(await recordOf(circle.id)).toBeUndefined();
        await sweep();
        expect(await recordOf(circle.id)).toBeUndefined();
        expect(await dumpEverything(test)).not.toContain(circle.id);
      }),
    SWEEP_TIMEOUT_MS,
  );
});

describe('small things of ended events and limits (QA Faz 8 D1, D3, D4, D6; QA 9.2 N2)', () => {
  it('D1: a stranger watching any circle leaves no counter behind', async () => {
    const stranger = await person(test);
    const circleId = randomUuid();
    await expect(watch(stranger, circleId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const redis = test.app.get<RedisClient>(REDIS);
    expect(await redis.exists(`rl:watch:${stranger.userId}:${circleId}`)).toBe(0);
  });

  it('D3: an event that has ended takes no codes or watching, even before the sweep', async () => {
    const { circle, owner } = await eventOfTwo();
    await endOnTime(circle.id);
    expect(
      (await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id }))
        .statusCode,
    ).toBe(404);
    await expect(watch(owner, circle.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('D4: a phone a little ahead still gets "a week"; one far off is refused', async () => {
    const owner = await person(test);
    const now = Date.now();
    const ahead = await createEvent(owner, now + EVENT_DURATION_MS.max + 5 * 60_000);
    expect(ahead.statusCode).toBe(201);
    expect(ahead.json<Circle>().expiresAt).toBeLessThanOrEqual(Date.now() + EVENT_DURATION_MS.max);
    const far = await createEvent(owner, now + EVENT_DURATION_MS.max + 2 * EVENT_CLOCK_SKEW_MS);
    expect(far.statusCode).toBe(400);
  });

  it('D6: an account opens only so many circles an hour', async () => {
    const owner = await person(test);
    for (let i = 0; i < CIRCLE_LIMITS.createdPerHour; i += 1) {
      expect(
        (await as(test, owner, 'POST', '/v1/circles', { kind: 'friends', name: `G${String(i)}` }))
          .statusCode,
      ).toBe(201);
    }
    expect(
      (await as(test, owner, 'POST', '/v1/circles', { kind: 'friends', name: 'Bir fazla' }))
        .statusCode,
    ).toBe(429);
  });

  it('N2: a counted step that rolled back gives its slot back', async () => {
    const limiter = test.app.get(RateLimiter);
    const key = `circle-joins:${randomUuid()}`;
    await limiter.hit(key, 100, 3600);
    await limiter.refund(key);
    expect(await limiter.peek(key)).toBe(0);
    await limiter.refund(key);
    expect(await limiter.peek(key)).toBe(0);
  });
});
