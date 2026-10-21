import {
  cosmeticPublicKey,
  createSenderState,
  decryptMessage,
  encryptMessage,
  fromBase64url,
  generateSenderKey,
  parseCosmeticKeys,
  ReplayGuard,
  verifyCosmeticPass,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import type { Circle, CosmeticPass, CosmeticPassReply, MessageEnvelope } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { call } from './support/client.js';
import { as, circleWith, type Person, person } from './support/people.js';

/** Test-only signing key: fresh per run, so it can never match a real one. */
const SIGNING_KEY = 'q'.repeat(42) + 'A';
const trusted = parseCosmeticKeys(`test-1:${cosmeticPublicKey(fromBase64url(SIGNING_KEY, 32))}`);

let test: TestApp;
let unsigned: TestApp;
let live: TestApp;

beforeAll(async () => {
  const signing = { ENTITLEMENT_SIGNING_KEY: SIGNING_KEY, ENTITLEMENT_SIGNING_KID: 'test-1' };
  test = await createTestApp({ env: testEnv({ ...signing, BILLING_TEST: 'on' }) });
  // Like production: a key, but no test purchases.
  live = await createTestApp({ env: testEnv(signing) });
  unsigned = await createTestApp();
});
afterAll(async () => {
  await test.close();
  await live.close();
  await unsigned.close();
});

const passOf = async (app: TestApp, who: Person) =>
  (await as(app, who, 'GET', '/v1/me/cosmetics/pass')).json<CosmeticPassReply>().pass;

describe('cosmetic pass (docs/ADR/0025 §1)', () => {
  it("gives the caller's own packs, signed, and only theirs", async () => {
    const [ada, bob] = [await person(test), await person(test)];
    expect(await passOf(test, ada)).toBeNull();
    await as(test, ada, 'POST', '/v1/billing/test/purchase', { product: 'cosmetic:rings' });
    await as(test, ada, 'POST', '/v1/billing/test/purchase', { product: 'cosmetic:frames' });
    const given = await passOf(test, ada);
    if (given === null) throw new Error('no pass');
    // Only the account, the packs and the times: no price, date of purchase or source.
    expect(Object.keys(given).sort()).toEqual(
      ['expiresAt', 'issuedAt', 'kid', 'packs', 'sig', 'userId', 'v'].sort(),
    );
    expect(given).toMatchObject({ kid: 'test-1', userId: ada.userId, packs: ['frames', 'rings'] });
    expect(given.expiresAt - given.issuedAt).toBe(30 * 24 * 3600_000);
    expect(
      verifyCosmeticPass(given, { keys: trusted, userId: ada.userId, now: Date.now() }),
    ).toEqual(new Set(['frames', 'rings']));
    // Nobody else can ask for Ada's: the route names no account, a query is ignored.
    const asked = await as(test, bob, 'GET', `/v1/me/cosmetics/pass?userId=${ada.userId}`);
    expect(asked.json<CosmeticPassReply>()).toEqual({ pass: null });
    expect((await call(test.app, { method: 'GET', url: '/v1/me/cosmetics/pass' })).statusCode).toBe(
      401,
    );
  });

  it('counts a test pack only where test purchases are on, and needs a signing key', async () => {
    const cem = await person(live);
    await live.admin.query(
      `INSERT INTO app.entitlements (user_id, product, source) VALUES ($1, 'cosmetic:rings', 'test')`,
      [cem.userId],
    );
    expect(await passOf(live, cem)).toBeNull();
    await live.admin.query(
      `INSERT INTO app.entitlements (user_id, product, source) VALUES ($1, 'cosmetic:frames', 'play')`,
      [cem.userId],
    );
    expect((await passOf(live, cem))?.packs).toEqual(['frames']);
    // No key on this server: no pass at all.
    const dan = await person(unsigned);
    expect((await as(unsigned, dan, 'GET', '/v1/me/cosmetics/pass')).statusCode).toBe(404);
  });
});

function lookMessage(who: Person, circle: Circle, pass: CosmeticPass | null) {
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  const { envelope } = encryptMessage({
    state: createSenderState(senderKey),
    sender: who.device,
    payload: { kind: 'look', ring: 'sparkle', frame: null, pass, ts: Date.now() },
  });
  return { envelope, senderKey };
}

describe('look messages (docs/ADR/0025 §3)', () => {
  it('reach circle-mates only, who check the pass themselves', async () => {
    const [eda, fuat, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, eda, fuat);
    await as(test, eda, 'POST', '/v1/billing/test/purchase', { product: 'cosmetic:rings' });
    const { envelope, senderKey } = lookMessage(eda, circle, await passOf(test, eda));
    expect((await as(test, eda, 'POST', '/v1/looks', { envelopes: [envelope] })).json()).toEqual({
      accepted: 1,
      refused: [],
    });

    const { envelopes } = (await as(test, fuat, 'GET', '/v1/looks')).json<{
      envelopes: MessageEnvelope[];
    }>();
    expect(envelopes).toHaveLength(1);
    const card = circle.members.find((member) => member.userId === eda.userId)?.device;
    if (card === undefined || card === null) throw new Error('no device card');
    const look = decryptMessage({
      envelope: envelopes[0],
      senderKey,
      sender: verifyDeviceKeyBundle(card.bundle),
      replay: new ReplayGuard(),
    });
    if (look.kind !== 'look') throw new Error('not a look');
    expect(
      verifyCosmeticPass(look.pass, { keys: trusted, userId: eda.userId, now: Date.now() }),
    ).toEqual(new Set(['rings']));
    // Shown as someone else's, the same pass does not hold.
    expect(
      verifyCosmeticPass(look.pass, { keys: trusted, userId: fuat.userId, now: Date.now() }),
    ).toBeNull();

    // Someone outside every circle gets nothing; the relay keeps ciphertext only.
    expect((await as(test, mallory, 'GET', '/v1/looks')).json()).toEqual({ envelopes: [] });
    expect(JSON.stringify(envelopes)).not.toContain('sparkle');
  });
});
