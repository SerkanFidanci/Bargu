import { Writable } from 'node:stream';

import {
  createSenderState,
  encryptHistory,
  encryptMessage,
  generateSenderKey,
  type SenderState,
} from '@bargu/crypto';
import {
  type Circle,
  type GuardianCode,
  type GuardianLink,
  type GuardianView,
  historySlot,
  HISTORY_SLOT_MS,
  type MessageEnvelope,
  type Plan,
  type PublishReply,
} from '@bargu/schemas';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { PlanEvents } from '../../src/billing/plan-events.js';
import { PLANS_SWEPT_KEY, PlanSweeper } from '../../src/billing/plan-sweeper.js';
import { EventsService } from '../../src/events/events.service.js';
import { Notifier } from '../../src/push/notifier.js';
import { entitlements } from '../../src/db/schema.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { call } from './support/client.js';
import { as, circleWith, consentToHistory, type Person, person } from './support/people.js';

let test: TestApp;
let logs = '';
beforeAll(async () => {
  // Everything the server logs, at the most verbose level, is searched for what must not be there.
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString('utf8');
      done();
    },
  });
  test = await createTestApp({
    env: testEnv({ LOG_LEVEL: 'trace', BILLING_TEST: 'on' }),
    logStream,
  });
});
afterAll(async () => {
  await test.close();
});

const DAY = 24 * 3600_000;
const planOf = async (who: Person) => (await as(test, who, 'GET', '/v1/me/plan')).json<Plan>();
const simulate = (who: Person, action: string) =>
  as(test, who, 'POST', '/v1/billing/test/simulate', { action });
const buy = (who: Person, product: string) =>
  as(test, who, 'POST', '/v1/billing/test/purchase', { product });
const circleAs = async (who: Person, circleId: string) =>
  (await as(test, who, 'GET', `/v1/circles/${circleId}`)).json<Circle>();

/** A member's phone in a circle: its sender key and sealed messages. */
function phone(who: Person, circle: Pick<Circle, 'id' | 'epoch'>) {
  let state: SenderState = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  return {
    location(): MessageEnvelope {
      const { envelope, nextState } = encryptMessage({
        state,
        sender: who.device,
        payload: { kind: 'loc', lat: 41, lng: 29, acc: 8, bat: 50, chg: false, ts: Date.now() },
      });
      state = nextState;
      return envelope;
    },
    trail(from: number): MessageEnvelope {
      const { envelope, nextState } = encryptHistory({
        state,
        sender: who.device,
        payload: { kind: 'trail', from, points: [[0, 4_100_823, 2_897_841, 9]], ts: from },
      });
      state = nextState;
      return envelope;
    },
  };
}

describe('Bargu+, the trial and paused circles (docs/ADR/0024)', () => {
  it('gives every new account a 21-day trial, shown to that account only', async () => {
    const before = Date.now();
    const ayse = await person(test);
    const plan = await planOf(ayse);
    expect(plan).toMatchObject({
      plan: 'trial',
      product: 'trial',
      source: 'bargu',
      graceUntil: null,
      cosmetics: [],
      testBilling: true,
    });
    expect(plan.trialEndsAt).toBeGreaterThanOrEqual(before + 21 * DAY - 60_000);
    expect(plan.trialEndsAt).toBeLessThanOrEqual(Date.now() + 21 * DAY + 60_000);
    // The trial is on the account's own records, nobody else's.
    const records = (await as(test, ayse, 'GET', '/v1/me/plan/records')).json<{
      records: { product: string }[];
    }>();
    expect(records.records.map((record) => record.product)).toEqual(['trial']);
  });

  it('pauses a circle nobody keeps open: location, history and arrivals wait, the rest works', async () => {
    const [ayse, bora] = [await person(test), await person(test)];
    const circle = await circleWith(test, ayse, bora);
    expect(circle).not.toHaveProperty('paused');
    const ayses = phone(ayse, circle);
    const sent = (
      await as(test, ayse, 'POST', '/v1/locations', { envelopes: [ayses.location()] })
    ).json<PublishReply>();
    expect(sent.accepted).toBe(1);
    const redis = test.app.get<RedisClient>(REDIS);
    expect(await redis.exists(`loc:${circle.id}`)).toBe(1);

    // Ayşe's trial ends: Bora's still keeps it open.
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    expect((await simulate(ayse, 'endTrial')).json<Plan>().plan).toBe('free');
    expect(await circleAs(ayse, circle.id)).not.toHaveProperty('paused');
    // Bora's ends too: nobody keeps it open now, and everyone in it hears so.
    expect((await simulate(bora, 'endTrial')).statusCode).toBe(200);
    expect((await circleAs(ayse, circle.id)).paused).toBe(true);
    expect((await circleAs(bora, circle.id)).paused).toBe(true);
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([ayse.userId, bora.userId]), {
      type: 'circle.changed',
      circleId: circle.id,
      epoch: circle.epoch,
    });
    expect(told).toHaveBeenCalledWith([bora.userId], { type: 'plan.changed' });
    told.mockRestore();
    // Nobody sees a frozen dot: the last locations went.
    expect(await redis.exists(`loc:${circle.id}`)).toBe(0);

    // Live location, history and place arrivals wait...
    const refused = (
      await as(test, ayse, 'POST', '/v1/locations', { envelopes: [ayses.location()] })
    ).json<PublishReply>();
    expect(refused).toEqual({ accepted: 0, refused: [{ circleId: circle.id, code: 'PAUSED' }] });
    await consentToHistory(test, ayse);
    const slot = historySlot(Date.now()) - HISTORY_SLOT_MS;
    const history = await as(
      test,
      ayse,
      'PUT',
      `/v1/circles/${circle.id}/history/${String(slot)}`,
      {
        envelope: ayses.trail(slot),
      },
    );
    expect(history.statusCode).toBe(403);
    expect(history.json()).toMatchObject({ code: 'CIRCLE_PAUSED' });
    const arrival = await as(test, ayse, 'POST', '/v1/place-events', {
      envelope: ayses.location(),
      pushes: [],
    });
    expect(arrival.json()).toEqual({ refused: 'PAUSED' });
    // ...a poke and a status do not.
    const poke = await as(test, ayse, 'POST', '/v1/bumps', { envelope: ayses.location() });
    expect(poke.json()).not.toEqual({ refused: 'PAUSED' });
    const status = (
      await as(test, ayse, 'POST', '/v1/statuses', {
        envelopes: [ayses.location()],
        ttlSeconds: 3600,
      })
    ).json<PublishReply>();
    expect(status.accepted).toBe(1);

    // Bora buys Bargu+: open again at once, for both.
    const bought = (await buy(bora, 'plus_month')).json<Plan>();
    expect(bought).toMatchObject({ plan: 'plus', product: 'plus_month', source: 'test' });
    expect(bought.autoRenew).toBe(true);
    expect(await circleAs(ayse, circle.id)).not.toHaveProperty('paused');
    expect(
      (
        await as(test, ayse, 'POST', '/v1/locations', { envelopes: [ayses.location()] })
      ).json<PublishReply>().accepted,
    ).toBe(1);
  });

  it("does what a store would do, to the caller's own test plan only", async () => {
    const [cem, dila] = [await person(test), await person(test)];
    const bought = (await buy(cem, 'plus_year')).json<Plan>();
    expect(bought).toMatchObject({ plan: 'plus', product: 'plus_year', autoRenew: true });
    expect(bought.expiresAt).toBeGreaterThan(Date.now() + 364 * DAY);

    expect((await simulate(cem, 'cancel')).json<Plan>()).toMatchObject({
      plan: 'plus',
      autoRenew: false,
    });
    const failed = (await simulate(cem, 'fail')).json<Plan>();
    expect(failed.plan).toBe('plus');
    expect(failed.graceUntil).toBeGreaterThan(Date.now() + 6 * DAY);
    expect((await simulate(cem, 'recover')).json<Plan>().graceUntil).toBeNull();
    const renewed = (await simulate(cem, 'renew')).json<Plan>();
    expect(renewed).toMatchObject({ plan: 'plus', autoRenew: true });
    // Refunded: the trial is what is left.
    expect((await simulate(cem, 'refund')).json<Plan>().plan).toBe('trial');

    // Dila has no test plan: nothing to act on, and nothing of Cem's changes.
    expect((await simulate(dila, 'cancel')).statusCode).toBe(404);
    // A cosmetic pack is kept for good.
    expect((await buy(dila, 'cosmetic:islands')).json<Plan>().cosmetics).toEqual(['islands']);

    // A plan from a store is never replaced or changed by a test purchase.
    await test.admin.query(
      `INSERT INTO app.entitlements (user_id, product, source, expires_at, auto_renew)
       VALUES ($1, 'plus_month', 'play', now() + interval '30 days', true)`,
      [dila.userId],
    );
    expect((await buy(dila, 'plus_year')).json()).toMatchObject({ code: 'ALREADY_SUBSCRIBED' });
    expect((await simulate(dila, 'expire')).statusCode).toBe(404);
    expect((await planOf(dila)).source).toBe('play');

    // Wrong input is refused before anything happens.
    expect((await buy(dila, 'plus_forever')).statusCode).toBe(400);
    expect((await simulate(dila, 'free')).statusCode).toBe(400);
  });

  it("lets an account write no plan of its own, and shows it no one else's (QA 19 P1, P2)", async () => {
    const [ilke, jale] = [await person(test), await person(test)];
    const circle = await circleWith(test, ilke, jale);
    const database = test.app.get(DatabaseService);
    // As the app role for Ilke: no row of hers can be added or changed directly, not even a store's.
    await expect(
      database.asUser(ilke.userId, (tx) =>
        tx.insert(entitlements).values({
          userId: ilke.userId,
          product: 'plus_year',
          source: 'play',
          expiresAt: new Date(Date.now() + 365 * DAY),
        }),
      ),
    ).rejects.toThrow();
    await expect(
      database.asUser(ilke.userId, (tx) =>
        tx.update(entitlements).set({ expiresAt: new Date(Date.now() + 365 * DAY) }),
      ),
    ).rejects.toThrow();
    expect((await planOf(ilke)).plan).toBe('trial');
    // The worker's functions answer nothing to a session: not her circles, not who ran out.
    const leaked = await database.asUser(ilke.userId, async (tx) => ({
      circles: (await tx.execute(sql`SELECT * FROM app.circles_openness_of(${jale.userId})`)).rows,
      ended: (
        await tx.execute(
          sql`SELECT * FROM app.plans_ended_between(now() - interval '1 year', now() + interval '1 year')`,
        )
      ).rows,
    }));
    expect(leaked).toEqual({ circles: [], ended: [] });
    expect((await test.app.get(PlanEvents).openness(jale.userId)).get(circle.id)).toBe(true);
  });

  it('tells the others only when the circle opens or closes, not who renewed (QA 19 P3)', async () => {
    const [kaan, lale] = [await person(test), await person(test)];
    const circle = await circleWith(test, kaan, lale);
    await buy(kaan, 'plus_month');
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    // Lale's trial keeps it open anyway: Kaan cancelling or renewing changes nothing for her.
    await simulate(kaan, 'cancel');
    await simulate(kaan, 'renew');
    expect(told).not.toHaveBeenCalledWith(expect.arrayContaining([lale.userId]), {
      type: 'circle.changed',
      circleId: circle.id,
      epoch: circle.epoch,
    });
    expect(told).toHaveBeenCalledWith([kaan.userId], { type: 'plan.changed' });
    told.mockRestore();
  });

  it('counts no test plan and writes none where test purchases are off (QA 20 P1b)', async () => {
    const [mert, nur] = [await person(test), await person(test)];
    const circle = await circleWith(test, mert, nur);
    await buy(mert, 'plus_year');
    await simulate(mert, 'endTrial');
    await simulate(nur, 'endTrial');
    // Production, as the migrator writes it there; only inside this transaction (other test files
    // share the database and keep test purchases on).
    const admin = await test.admin.connect();
    try {
      await admin.query('BEGIN');
      await admin.query(`UPDATE app.settings SET value = 'off' WHERE key = 'billing_test'`);
      const plus = await admin.query<{ on: boolean }>('SELECT app.plus_active($1) AS on', [
        mert.userId,
      ]);
      expect(plus.rows[0]?.on).toBe(false);
      const open = await admin.query<{ open: boolean }>(
        'SELECT open FROM app.circles_openness_of($1) WHERE circle_id = $2',
        [mert.userId, circle.id],
      );
      expect(open.rows[0]?.open).toBe(false);
      // As the app role for Mert, the way an SQL injection would: no test plan can be written.
      await admin.query('SET LOCAL ROLE bargu_app');
      await admin.query(`SELECT set_config('app.user_id', $1, true)`, [mert.userId]);
      await expect(
        admin.query(
          `SELECT app.add_test_entitlement('plus_month', now() + interval '1 day', true)`,
        ),
      ).rejects.toThrow(/not allowed/);
    } finally {
      await admin.query('ROLLBACK');
      admin.release();
    }
    // Where test purchases are on (staging), the same plan counts again.
    expect((await planOf(mert)).plan).toBe('plus');
  });

  it('ends a test plan within a year, an early renewal as at the period end (QA 20 P1b)', async () => {
    const oya = await person(test);
    const database = test.app.get(DatabaseService);
    // The app role's own call: a hundred years is refused, as is a plan with no end.
    for (const end of [sql`now() + interval '100 years'`, sql`NULL`]) {
      await expect(
        database.asUser(oya.userId, (tx) =>
          tx.execute(sql`SELECT app.add_test_entitlement('plus_year', ${end}, true)`),
        ),
      ).rejects.toThrow();
    }
    await buy(oya, 'plus_year');
    expect((await simulate(oya, 'renew')).statusCode).toBe(200);
    // One period from now, as if now were the end of the old one: never two years ahead.
    const { expiresAt } = await planOf(oya);
    expect(expiresAt).toBeGreaterThan(Date.now() + 364 * DAY);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 365 * DAY);
  });

  it("buys for 15-17 only with a parent's yes, asked from the purchase (ADR 0024 §5)", async () => {
    const teen = await person(test, 'Deniz', '15-17');
    expect((await planOf(teen)).plan).toBe('trial');
    // No parent linked: nobody could say yes, and nothing is kept.
    expect((await buy(teen, 'plus_month')).json()).toMatchObject({
      code: 'GUARDIAN_LINK_REQUIRED',
    });
    const parent = await person(test, 'Ayşe');
    const code = (await as(test, teen, 'POST', '/v1/guardians/code')).json<GuardianCode>();
    const link = (
      await as(test, parent, 'POST', '/v1/guardians/accept', { token: code.token })
    ).json<GuardianLink>();
    await as(test, teen, 'POST', `/v1/guardians/${link.id}/confirm`);
    const view = async () =>
      (await as(test, parent, 'GET', `/v1/guardians/${link.id}`)).json<GuardianView>();
    const answer = (requestId: string, yes: boolean) =>
      as(
        test,
        parent,
        'POST',
        `/v1/guardians/${link.id}/requests/${requestId}/${yes ? 'approve' : 'decline'}`,
      );
    const notified = vi.spyOn(test.app.get(Notifier), 'notifyGuardians');
    const told = vi.spyOn(test.app.get(EventsService), 'publish');

    expect((await buy(teen, 'plus_month')).json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    // The other plan changes the request (told again); the same again tells nobody again.
    expect((await buy(teen, 'plus_year')).json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    expect((await buy(teen, 'plus_year')).statusCode).toBe(403);
    expect(notified).toHaveBeenCalledTimes(2);
    expect(notified).toHaveBeenCalledWith([parent.userId], 'guardianPurchase', teen.userId);
    expect(await planOf(teen)).toMatchObject({ product: 'trial', pendingPurchase: 'plus_year' });
    const [asked] = (await view()).requests;
    expect(asked).toMatchObject({ kind: 'purchase', product: 'plus_year', name: null, by: null });
    if (asked === undefined) throw new Error('no request');
    // An app before level 2 cannot read the kind: it is not sent it (ADR 0024 §10, PM).
    const older = await call(test.app, {
      method: 'GET',
      url: `/v1/guardians/${link.id}`,
      accessToken: parent.session.accessToken,
      clientLevel: 1,
    });
    expect(older.json<GuardianView>().requests).toEqual([]);

    // A no drops it, and the child's Bargu+ screen hears it.
    told.mockClear();
    expect((await answer(asked.id, false)).json()).toEqual({ done: false });
    expect(told).toHaveBeenCalledWith([teen.userId], { type: 'plan.changed' });
    expect((await planOf(teen)).pendingPurchase).toBeNull();

    // Asked again, a yes buys it as the child.
    await buy(teen, 'plus_month');
    const [again] = (await view()).requests;
    if (again === undefined) throw new Error('no request');
    expect((await answer(again.id, true)).json()).toEqual({ done: true });
    expect(await planOf(teen)).toMatchObject({
      plan: 'plus',
      product: 'plus_month',
      source: 'test',
      pendingPurchase: null,
    });
    expect((await view()).requests).toEqual([]);
    // A pack waits for slice 3: refused, not asked.
    expect((await buy(teen, 'cosmetic:islands')).json()).toMatchObject({
      code: 'GUARDIAN_APPROVAL',
    });
    notified.mockRestore();
    told.mockRestore();
  });

  it('takes two "ask my parent" taps at once as one request, never a 500 (QA 21 B-1)', async () => {
    const teen = await person(test, 'Ege', '15-17');
    const parent = await person(test, 'Filiz');
    const code = (await as(test, teen, 'POST', '/v1/guardians/code')).json<GuardianCode>();
    const link = (
      await as(test, parent, 'POST', '/v1/guardians/accept', { token: code.token })
    ).json<GuardianLink>();
    await as(test, teen, 'POST', `/v1/guardians/${link.id}/confirm`);
    const notified = vi.spyOn(test.app.get(Notifier), 'notifyGuardians');
    for (let round = 0; round < 5; round += 1) {
      notified.mockClear();
      const replies = await Promise.all([buy(teen, 'plus_month'), buy(teen, 'plus_month')]);
      for (const reply of replies) {
        expect(reply.json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
      }
      // One request, its parent told once.
      const { requests } = (
        await as(test, parent, 'GET', `/v1/guardians/${link.id}`)
      ).json<GuardianView>();
      expect(requests).toHaveLength(1);
      expect(notified).toHaveBeenCalledTimes(1);
      // A no drops it: the next round asks anew.
      const [asked] = requests;
      if (asked === undefined) throw new Error('no request');
      await as(test, parent, 'POST', `/v1/guardians/${link.id}/requests/${asked.id}/decline`);
    }
    notified.mockRestore();
  });

  it('tells the circles when plans run out with time, once (the worker)', async () => {
    const [efe, fatma] = [await person(test), await person(test)];
    const circle = await circleWith(test, efe, fatma);
    const redis = test.app.get<RedisClient>(REDIS);
    const sweeper = new PlanSweeper(test.app.get(DatabaseService), test.app.get(PlanEvents), redis);
    const until = Date.now();
    await redis.set(PLANS_SWEPT_KEY, String(until - 60_000));
    await test.admin.query(
      `UPDATE app.entitlements SET expires_at = now() - interval '5 seconds'
        WHERE product = 'trial' AND user_id = ANY($1)`,
      [[efe.userId, fatma.userId]],
    );
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    expect(await sweeper.sweep(until)).toBeGreaterThanOrEqual(2);
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([efe.userId, fatma.userId]), {
      type: 'circle.changed',
      circleId: circle.id,
      epoch: circle.epoch,
    });
    expect((await circleAs(efe, circle.id)).paused).toBe(true);
    // The next round starts where this one stopped: the same ends are not told again.
    told.mockClear();
    await sweeper.sweep(Date.now());
    expect(told).not.toHaveBeenCalledWith([efe.userId], { type: 'plan.changed' });
    told.mockRestore();
  });

  it('keeps no email, token or location in billing records or logs', async () => {
    const gul = await person(test);
    await buy(gul, 'plus_month');
    await simulate(gul, 'fail');
    const { rows } = await test.admin.query<Record<string, unknown>>(
      `SELECT * FROM app.entitlements WHERE user_id = $1`,
      [gul.userId],
    );
    const stored = JSON.stringify(rows);
    for (const secret of [gul.email, gul.session.accessToken, gul.session.refreshToken]) {
      expect(stored).not.toContain(secret);
      expect(logs).not.toContain(secret);
    }
    expect(logs).toContain('/v1/billing/test/purchase');
  });
});

describe('test billing not turned on (docs/ADR/0024 §6, fail-closed)', () => {
  // Nothing set, as on a server whose setting went missing.
  let off: TestApp;
  beforeAll(async () => {
    off = await createTestApp({ env: testEnv() });
  });
  afterAll(async () => {
    await off.close();
  });

  it('answers 404, as if the routes did not exist, and says so in the plan', async () => {
    const hakan = await person(off);
    const purchase = await as(off, hakan, 'POST', '/v1/billing/test/purchase', {
      product: 'plus_month',
    });
    expect(purchase.statusCode).toBe(404);
    const simulated = await as(off, hakan, 'POST', '/v1/billing/test/simulate', {
      action: 'endTrial',
    });
    expect(simulated.statusCode).toBe(404);
    const plan = (await as(off, hakan, 'GET', '/v1/me/plan')).json<Plan>();
    expect(plan).toMatchObject({ plan: 'trial', testBilling: false });
  });
});
