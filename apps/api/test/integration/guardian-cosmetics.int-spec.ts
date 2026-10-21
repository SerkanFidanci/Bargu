import {
  cosmeticPublicKey,
  fromBase64url,
  parseCosmeticKeys,
  verifyCosmeticPass,
} from '@bargu/crypto';
import {
  CLIENT_LEVEL,
  CLIENT_LEVEL_FOR,
  type CosmeticPassReply,
  type GuardianCode,
  type GuardianLink,
  type GuardianRequest,
  type GuardianView,
  type Plan,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EventsService } from '../../src/events/events.service.js';
import { GuardianSweeper } from '../../src/guardians/guardian-sweeper.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { Notifier } from '../../src/push/notifier.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { call } from './support/client.js';
import { as, type Person, person } from './support/people.js';

/** Test-only signing key: fresh per run, so it can never match a real one. */
const SIGNING_KEY = 'q'.repeat(42) + 'A';
const trusted = parseCosmeticKeys(`test-1:${cosmeticPublicKey(fromBase64url(SIGNING_KEY, 32))}`);

let test: TestApp;
let off: TestApp;
beforeAll(async () => {
  const signing = { ENTITLEMENT_SIGNING_KEY: SIGNING_KEY, ENTITLEMENT_SIGNING_KID: 'test-1' };
  test = await createTestApp({ env: testEnv({ ...signing, BILLING_TEST: 'on' }) });
  // Test purchases not turned on (fail-closed, ADR 0024 §6): there is nothing to ask for.
  off = await createTestApp({ env: testEnv() });
});
afterAll(async () => {
  await test.close();
  await off.close();
});

const buy = (who: Person, product: string, app: TestApp = test) =>
  as(app, who, 'POST', '/v1/billing/test/purchase', { product });
const planOf = async (who: Person) => (await as(test, who, 'GET', '/v1/me/plan')).json<Plan>();
const passOf = async (who: Person) =>
  (await as(test, who, 'GET', '/v1/me/cosmetics/pass')).json<CosmeticPassReply>().pass;

/** A parent and a teen linked as the app does it: code, the parent's yes, the child's yes. */
async function family(app: TestApp = test) {
  const teen = await person(app, 'Deniz', '15-17');
  const parent = await person(app, 'Ayşe');
  const code = (await as(app, teen, 'POST', '/v1/guardians/code')).json<GuardianCode>();
  const taken = (
    await as(app, parent, 'POST', '/v1/guardians/accept', { token: code.token })
  ).json<GuardianLink>();
  await as(app, teen, 'POST', `/v1/guardians/${taken.id}/confirm`);
  return { teen, parent, link: taken.id };
}

const viewAs = async (who: Person, link: string, clientLevel: number = CLIENT_LEVEL) =>
  (
    await call(test.app, {
      method: 'GET',
      url: `/v1/guardians/${link}`,
      accessToken: who.session.accessToken,
      clientLevel,
    })
  ).json<GuardianView>();
const requestsOf = async (who: Person, link: string, clientLevel?: number) =>
  (await viewAs(who, link, clientLevel)).requests;
const answer = (parent: Person, link: string, request: GuardianRequest, yes: boolean) =>
  as(
    test,
    parent,
    'POST',
    `/v1/guardians/${link}/requests/${request.id}/${yes ? 'approve' : 'decline'}`,
  );
const stored = async (child: Person) =>
  (
    await test.admin.query<{ kind: string; product: string }>(
      `SELECT kind, product FROM app.guardian_requests
        WHERE child_id = $1 AND kind IN ('purchase', 'cosmetic') ORDER BY product`,
      [child.userId],
    )
  ).rows;

describe('a 15-17 account asks a parent for a cosmetic pack (docs/ADR/0025 §6, slice 3c)', () => {
  it('keeps the request, tells the parent once and shows the child it waits', async () => {
    const { teen, parent, link } = await family();
    const notified = vi.spyOn(test.app.get(Notifier), 'notifyGuardians');
    const told = vi.spyOn(test.app.get(EventsService), 'publish');

    // The server answers like every request that waits for a parent, and keeps nothing bought.
    const asked = await buy(teen, 'cosmetic:rings');
    expect(asked.statusCode).toBe(403);
    expect(asked.json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified).toHaveBeenCalledWith([parent.userId], 'guardianCosmetic', teen.userId);
    // The child's look screen hears it on every phone, the parent's view reads again.
    expect(told).toHaveBeenCalledWith([teen.userId], { type: 'plan.changed' });
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([teen.userId, parent.userId]), {
      type: 'guardians.changed',
    });
    expect(await planOf(teen)).toMatchObject({
      cosmetics: [],
      pendingCosmetics: ['rings'],
      pendingPurchase: null,
    });

    // The parent sees it, by its pack; the child sees the same.
    const [seen] = await requestsOf(parent, link);
    expect(seen).toMatchObject({ kind: 'cosmetic', pack: 'rings', name: null, by: null });
    expect(await requestsOf(teen, link)).toEqual([seen]);
    // Nothing else of the account moved: not a cosmetic, not a plan.
    expect(await passOf(teen)).toBeNull();
    notified.mockRestore();
    told.mockRestore();
  });

  it('is one request per pack: asking again keeps it and tells nobody again, another pack is another', async () => {
    const { teen, parent, link } = await family();
    const notified = vi.spyOn(test.app.get(Notifier), 'notifyGuardians');
    for (let again = 0; again < 3; again += 1) {
      expect((await buy(teen, 'cosmetic:rings')).json()).toMatchObject({
        code: 'GUARDIAN_APPROVAL',
      });
    }
    expect(await requestsOf(parent, link)).toHaveLength(1);
    expect(notified).toHaveBeenCalledTimes(1);
    expect((await buy(teen, 'cosmetic:frames')).json()).toMatchObject({
      code: 'GUARDIAN_APPROVAL',
    });
    expect(notified).toHaveBeenCalledTimes(2);
    const requests = await requestsOf(parent, link);
    expect(requests.map((request) => request.pack).sort()).toEqual(['frames', 'rings']);
    expect((await planOf(teen)).pendingCosmetics?.sort()).toEqual(['frames', 'rings']);
    expect(await stored(teen)).toEqual([
      { kind: 'cosmetic', product: 'cosmetic:frames' },
      { kind: 'cosmetic', product: 'cosmetic:rings' },
    ]);
    notified.mockRestore();
  });

  it('takes two taps at once as one request, never a 500', async () => {
    const { teen, parent, link } = await family();
    const notified = vi.spyOn(test.app.get(Notifier), 'notifyGuardians');
    for (let round = 0; round < 4; round += 1) {
      notified.mockClear();
      const replies = await Promise.all([
        buy(teen, 'cosmetic:frames'),
        buy(teen, 'cosmetic:frames'),
        buy(teen, 'cosmetic:frames'),
      ]);
      for (const reply of replies) {
        expect(reply.json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
      }
      const requests = await requestsOf(parent, link);
      expect(requests).toHaveLength(1);
      expect(notified).toHaveBeenCalledTimes(1);
      const [asked] = requests;
      if (asked === undefined) throw new Error('no request');
      await answer(parent, link, asked, false);
    }
    notified.mockRestore();
  });

  it('is apart from a Bargu+ request: neither deletes or replaces the other, the parent sees both', async () => {
    const { teen, parent, link } = await family();
    // Bargu+ first, then a pack.
    expect((await buy(teen, 'plus_month')).json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    expect((await buy(teen, 'cosmetic:rings')).json()).toMatchObject({ code: 'GUARDIAN_APPROVAL' });
    const both = await requestsOf(parent, link);
    expect(both.map((request) => request.kind).sort()).toEqual(['cosmetic', 'purchase']);
    expect(both.find((request) => request.kind === 'purchase')?.product).toBe('plus_month');
    expect(both.find((request) => request.kind === 'cosmetic')?.pack).toBe('rings');
    expect(await planOf(teen)).toMatchObject({
      pendingPurchase: 'plus_month',
      pendingCosmetics: ['rings'],
    });

    // The other plan changes the Bargu+ request only; the pack stays.
    expect((await buy(teen, 'plus_year')).statusCode).toBe(403);
    // The other pack and the same pack again leave the Bargu+ request alone.
    expect((await buy(teen, 'cosmetic:frames')).statusCode).toBe(403);
    expect((await buy(teen, 'cosmetic:rings')).statusCode).toBe(403);
    const all = await requestsOf(parent, link);
    expect(all).toHaveLength(3);
    expect(all.find((request) => request.kind === 'purchase')?.product).toBe('plus_year');
    expect(
      all
        .filter((request) => request.kind === 'cosmetic')
        .map((request) => request.pack)
        .sort(),
    ).toEqual(['frames', 'rings']);

    // Answering the pack leaves Bargu+ waiting, and the reverse.
    const rings = all.find((request) => request.pack === 'rings');
    if (rings === undefined) throw new Error('no request');
    expect((await answer(parent, link, rings, false)).json()).toEqual({ done: false });
    expect(await planOf(teen)).toMatchObject({
      pendingPurchase: 'plus_year',
      pendingCosmetics: ['frames'],
    });
    const plus = (await requestsOf(parent, link)).find((request) => request.kind === 'purchase');
    if (plus === undefined) throw new Error('no request');
    expect((await answer(parent, link, plus, false)).json()).toEqual({ done: false });
    expect(await planOf(teen)).toMatchObject({
      pendingPurchase: null,
      pendingCosmetics: ['frames'],
    });
    expect(await stored(teen)).toEqual([{ kind: 'cosmetic', product: 'cosmetic:frames' }]);
  });

  it('is bought as the child on the parent’s yes: the pass names the pack, the child hears it', async () => {
    const { teen, parent, link } = await family();
    await buy(teen, 'cosmetic:rings');
    await buy(teen, 'cosmetic:frames');
    const [rings] = (await requestsOf(parent, link)).filter((request) => request.pack === 'rings');
    if (rings === undefined) throw new Error('no request');
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    const notified = vi.spyOn(test.app.get(Notifier), 'notify');

    expect((await answer(parent, link, rings, true)).json()).toEqual({ done: true });
    // The child hears the answer, and their look screen reads its plan again.
    expect(told).toHaveBeenCalledWith([teen.userId], { type: 'plan.changed' });
    expect(notified).toHaveBeenCalledWith([teen.userId], 'guardianApproved', link);
    const plan = await planOf(teen);
    expect(plan).toMatchObject({ cosmetics: ['rings'], pendingCosmetics: ['frames'] });
    const signed = await passOf(teen);
    expect(signed?.packs).toEqual(['rings']);
    if (signed === null) throw new Error('no document');
    expect(
      verifyCosmeticPass(signed, { keys: trusted, userId: teen.userId, now: Date.now() }),
    ).toEqual(new Set(['rings']));
    // The row is a test purchase, as an adult's would be; the other pack still waits.
    const rows = await test.admin.query<{ product: string; source: string }>(
      `SELECT product, source FROM app.entitlements WHERE user_id = $1 AND product LIKE 'cosmetic:%'`,
      [teen.userId],
    );
    expect(rows.rows).toEqual([{ product: 'cosmetic:rings', source: 'test' }]);
    expect((await requestsOf(parent, link)).map((request) => request.pack)).toEqual(['frames']);
    // A pack the child has needs no one's yes any more: asking changes nothing and tells nobody.
    notified.mockClear();
    const again = await buy(teen, 'cosmetic:rings');
    expect(again.statusCode).toBe(200);
    expect(again.json<Plan>().cosmetics).toEqual(['rings']);
    expect(notified).not.toHaveBeenCalled();
    expect(await requestsOf(parent, link)).toHaveLength(1);
    told.mockRestore();
    notified.mockRestore();
  });

  it('is dropped on the parent’s no: nothing bought, the child stops waiting and may ask again', async () => {
    const { teen, parent, link } = await family();
    await buy(teen, 'cosmetic:frames');
    const [asked] = await requestsOf(parent, link);
    if (asked === undefined) throw new Error('no request');
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    const notified = vi.spyOn(test.app.get(Notifier), 'notify');

    expect((await answer(parent, link, asked, false)).json()).toEqual({ done: false });
    expect(told).toHaveBeenCalledWith([teen.userId], { type: 'plan.changed' });
    expect(notified).toHaveBeenCalledWith([teen.userId], 'guardianDeclined', link);
    expect(await planOf(teen)).toMatchObject({ cosmetics: [], pendingCosmetics: [] });
    expect(await requestsOf(parent, link)).toEqual([]);
    expect(await passOf(teen)).toBeNull();
    // An answered request cannot be answered again.
    expect((await answer(parent, link, asked, true)).statusCode).toBe(404);
    // Asked anew, it is a new request and the parent is told again.
    notified.mockClear();
    expect((await buy(teen, 'cosmetic:frames')).statusCode).toBe(403);
    expect(notified).toHaveBeenCalledWith([parent.userId], 'guardianCosmetic', teen.userId);
    expect(await requestsOf(parent, link)).toHaveLength(1);
    told.mockRestore();
    notified.mockRestore();
  });

  it('is nobody else’s to see or answer: not a stranger’s, not another family’s parent', async () => {
    const mine = await family();
    const other = await family();
    const stranger = await person(test, 'Fikret');
    await buy(mine.teen, 'cosmetic:rings');
    const [asked] = await requestsOf(mine.parent, mine.link);
    if (asked === undefined) throw new Error('no request');

    for (const who of [stranger, other.parent, other.teen]) {
      // The view is not theirs, and neither is the answer, however they name the link.
      expect((await as(test, who, 'GET', `/v1/guardians/${mine.link}`)).statusCode).toBe(404);
      for (const link of [mine.link, other.link]) {
        for (const yes of [true, false]) {
          const reply = await answer(who, link, asked, yes);
          expect(reply.statusCode).toBe(404);
        }
      }
    }
    // The other family's parent sees their own view only, with nothing of this child's.
    expect(await requestsOf(other.parent, other.link)).toEqual([]);
    // The child cannot answer for the parent either.
    expect((await answer(mine.teen, mine.link, asked, true)).statusCode).toBe(404);
    // Nothing was bought, nothing dropped: the request waits as before.
    expect(await requestsOf(mine.parent, mine.link)).toEqual([asked]);
    expect((await planOf(mine.teen)).cosmetics).toEqual([]);
    // Other accounts' plans show nothing of it.
    expect(await planOf(other.teen)).toMatchObject({ pendingCosmetics: [] });
    expect(await planOf(stranger)).toMatchObject({ pendingCosmetics: [] });
  });

  it('asks nobody of an adult, who buys directly, and keeps nothing when no parent is linked', async () => {
    const adult = await person(test, 'Ece');
    const notified = vi.spyOn(test.app.get(Notifier), 'notifyGuardians');
    const bought = await buy(adult, 'cosmetic:rings');
    expect(bought.statusCode).toBe(200);
    expect(bought.json<Plan>()).toMatchObject({ cosmetics: ['rings'], pendingCosmetics: [] });
    expect(notified).not.toHaveBeenCalled();
    expect(await stored(adult)).toEqual([]);

    // A 15-17 with no parent: nobody could say yes, so nothing is kept or told.
    const lone = await person(test, 'Kerem', '15-17');
    const refused = await buy(lone, 'cosmetic:frames');
    expect(refused.statusCode).toBe(403);
    expect(refused.json()).toMatchObject({ code: 'GUARDIAN_LINK_REQUIRED' });
    expect(await stored(lone)).toEqual([]);
    expect((await planOf(lone)).pendingCosmetics).toEqual([]);
    expect(notified).not.toHaveBeenCalled();
    notified.mockRestore();
  });

  it('refuses a pack that does not exist, before anything is kept', async () => {
    const { teen, parent, link } = await family();
    for (const product of ['cosmetic:confetti', 'cosmetic:', 'cosmetic:RINGS']) {
      expect((await buy(teen, product)).statusCode).toBe(400);
    }
    expect(await requestsOf(parent, link)).toEqual([]);
    expect(await stored(teen)).toEqual([]);
  });

  it('sends the request only to apps that can read it, and an older parent’s app keeps working', async () => {
    const { teen, parent, link } = await family();
    await buy(teen, 'plus_month');
    await buy(teen, 'cosmetic:rings');
    expect(CLIENT_LEVEL).toBeGreaterThanOrEqual(CLIENT_LEVEL_FOR.cosmeticRequests);
    const kinds = async (level: number) =>
      (await requestsOf(parent, link, level)).map((request) => request.kind).sort();
    // Level 4 and newer: both. Level 3 (meetings) and 2 (purchase requests): Bargu+ only, no
    // request it cannot show. Level 1 and apps that send none: neither.
    expect(await kinds(CLIENT_LEVEL_FOR.cosmeticRequests)).toEqual(['cosmetic', 'purchase']);
    expect(await kinds(CLIENT_LEVEL_FOR.cosmeticRequests + 1)).toEqual(['cosmetic', 'purchase']);
    expect(await kinds(CLIENT_LEVEL_FOR.cosmeticRequests - 1)).toEqual(['purchase']);
    expect(await kinds(CLIENT_LEVEL_FOR.purchaseRequests)).toEqual(['purchase']);
    expect(await kinds(1)).toEqual([]);
    expect(await kinds(0)).toEqual([]);
    const silent = await call(test.app, {
      method: 'GET',
      url: `/v1/guardians/${link}`,
      accessToken: parent.session.accessToken,
      clientLevel: null,
    });
    expect(silent.json<GuardianView>().requests).toEqual([]);

    // The settings answer returns the same view, with the same rule.
    const saved = await call(test.app, {
      method: 'PUT',
      url: `/v1/guardians/${link}/settings`,
      accessToken: parent.session.accessToken,
      device: parent.device,
      body: { approveNewPeople: true, dailyLimitMinutes: null },
      clientLevel: CLIENT_LEVEL_FOR.cosmeticRequests - 1,
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json<GuardianView>().requests.map((request) => request.kind)).toEqual([
      'purchase',
    ]);
    // The request is not gone for the newer app, and answerable there.
    expect(await kinds(CLIENT_LEVEL)).toEqual(['cosmetic', 'purchase']);
  });

  it('drops the request when nobody answers in 7 days, and the child stops waiting', async () => {
    const { teen, parent, link } = await family();
    await buy(teen, 'cosmetic:rings');
    await buy(teen, 'plus_year');
    await test.admin.query(
      `UPDATE app.guardian_requests SET created_at = now() - interval '8 days'
        WHERE child_id = $1 AND kind = 'cosmetic'`,
      [teen.userId],
    );
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    const sweeper = new GuardianSweeper(
      test.app.get(DatabaseService),
      test.app.get(EventsService),
      test.app.get<RedisClient>(REDIS),
    );
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    // The child's view and plan are read again on every phone of theirs.
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([teen.userId]), {
      type: 'plan.changed',
    });
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([teen.userId]), {
      type: 'guardians.changed',
    });
    expect(await planOf(teen)).toMatchObject({
      pendingCosmetics: [],
      pendingPurchase: 'plus_year',
    });
    expect((await requestsOf(parent, link)).map((request) => request.kind)).toEqual(['purchase']);
    told.mockRestore();
  });

  it('goes with the link: when the last parent goes, the pack stops waiting', async () => {
    const { teen, parent, link } = await family();
    await buy(teen, 'cosmetic:frames');
    expect((await planOf(teen)).pendingCosmetics).toEqual(['frames']);
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    expect((await as(test, parent, 'POST', `/v1/guardians/${link}/end`)).statusCode).toBe(200);
    expect(told).toHaveBeenCalledWith([teen.userId], { type: 'plan.changed' });
    expect(await stored(teen)).toEqual([]);
    expect((await planOf(teen)).pendingCosmetics).toEqual([]);
    // With no parent, asking again is refused as before.
    expect((await buy(teen, 'cosmetic:frames')).json()).toMatchObject({
      code: 'GUARDIAN_LINK_REQUIRED',
    });
    told.mockRestore();
  });

  it('keeps no email, token or location in the request, and asks nothing where test purchases are off', async () => {
    const { teen, link } = await family();
    await buy(teen, 'cosmetic:rings');
    const { rows } = await test.admin.query<Record<string, unknown>>(
      `SELECT * FROM app.guardian_requests WHERE child_id = $1`,
      [teen.userId],
    );
    expect(rows).toHaveLength(1);
    const text = JSON.stringify(rows);
    for (const secret of [teen.email, teen.session.accessToken, teen.session.refreshToken, link]) {
      expect(text).not.toContain(secret);
    }

    // Test purchases not turned on: the route is not there, and nothing is kept.
    const closed = await family(off);
    expect((await buy(closed.teen, 'cosmetic:rings', off)).statusCode).toBe(404);
    expect(
      (
        await off.admin.query(`SELECT 1 FROM app.guardian_requests WHERE child_id = $1`, [
          closed.teen.userId,
        ])
      ).rows,
    ).toEqual([]);
  });

  it('writes only what the database allows: kinds, products and one request per pack', async () => {
    const { teen } = await family();
    const insert = (kind: string, product: string | null) =>
      test.admin.query(
        `INSERT INTO app.guardian_requests (child_id, kind, product) VALUES ($1, $2, $3)`,
        [teen.userId, kind, product],
      );
    // A cosmetic request names a pack, a purchase a plan: never the other way round.
    await expect(insert('cosmetic', null)).rejects.toThrow();
    await expect(insert('cosmetic', 'plus_month')).rejects.toThrow();
    await expect(insert('cosmetic', 'cosmetic:Rings')).rejects.toThrow();
    await expect(insert('cosmetic', `cosmetic:${'a'.repeat(17)}`)).rejects.toThrow();
    await expect(insert('purchase', 'cosmetic:rings')).rejects.toThrow();
    await expect(insert('friend', 'cosmetic:rings')).rejects.toThrow();
    await insert('cosmetic', 'cosmetic:rings');
    await expect(insert('cosmetic', 'cosmetic:rings')).rejects.toThrow(/unique|duplicate/);
    await insert('cosmetic', 'cosmetic:frames');
    await insert('purchase', 'plus_month');
  });
});
