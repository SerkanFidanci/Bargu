import {
  createSenderState,
  encryptMessage,
  fromBase64url,
  generateSenderKey,
  generateToken,
  noticePublicKey,
  openPush,
  openSealed,
  parseNoticeKeys,
  randomUuid,
  sealForDevice,
  sealPush,
  verifyDeviceKeyBundle,
  verifyServerNotice,
  type DevicePublicKeys,
} from '@bargu/crypto';
import {
  type Circle,
  type MessageEnvelope,
  type Payload,
  PUSH_NOTICES,
  type PushBody,
} from '@bargu/schemas';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/request-context.js';
import type { Env } from '../../src/config/env.js';
import { JOB_QUEUE } from '../../src/jobs/jobs.module.js';
import type { PushJob } from '../../src/push/notifier.js';
import { PushTokens, type PushTarget } from '../../src/push/push-tokens.js';
import { PushWorker } from '../../src/push/push.worker.js';
import { RelayService } from '../../src/relay/relay.service.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { as, circleWith, createCircle, type Person, person } from './support/people.js';

/**
 * QA-28 B-1: server notices are signed with the server's own notice key, for one device. A member
 * knows every other member's DH key, so they can seal anything for them, and the server carries it
 * like any of their notifications; but no app that checks takes it for the server's word.
 */

/** A throwaway RSA key in PEM (WebCrypto: test files stay off node:crypto too). */
async function testPrivateKeyPem(): Promise<string> {
  const keys = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey));
  return `-----BEGIN PRIVATE KEY-----
${pkcs8.toString('base64')}
-----END PRIVATE KEY-----
`;
}

// A throwaway service account: the API only queues pushes, nothing is sent to Google in tests.
const account = Buffer.from(
  JSON.stringify({
    type: 'service_account',
    project_id: 'bargu-test',
    client_email: 'push@bargu-test.iam.gserviceaccount.com',
    private_key: await testPrivateKeyPem(),
  }),
).toString('base64');

const NOTICE_KEY = generateToken();
/** What a preview build trusts: the public half only (EXPO_PUBLIC_NOTICE_KEYS). */
const trusted = parseNoticeKeys(`test-n1:${noticePublicKey(fromBase64url(NOTICE_KEY))}`);
/** The phone's freshness for `watch` (apps/mobile background-push.ts WATCH_FRESH_MS). */
const WATCH_FRESH_MS = 2 * 60_000;

let test: TestApp;
let unsignedEnv: Env;

beforeAll(async () => {
  test = await createTestApp({
    env: testEnv({
      FCM_SERVICE_ACCOUNT: account,
      WATCH_PUSH: 'on',
      NOTICE_SIGNING_KEY: NOTICE_KEY,
      NOTICE_SIGNING_KID: 'test-n1',
    }),
  });
  unsignedEnv = testEnv({ FCM_SERVICE_ACCOUNT: account });
});
afterAll(async () => {
  await test.close();
});

/**
 * The push worker as the worker process builds it from its environment (not started: it seals,
 * nothing is sent).
 */
const workerWith = (env: Env) =>
  new PushWorker(test.app.get<PgBoss>(JOB_QUEUE), env, test.app.get(PushTokens));

const register = async (who: Person) => {
  const reply = await as(test, who, 'PUT', '/v1/push', {
    token: `token-${who.userId}`,
    platform: 'android',
    locale: 'tr',
  });
  expect(reply.statusCode).toBe(204);
};

async function targetOf(who: Person): Promise<PushTarget> {
  const target = await test.app.get(PushTokens).targetOf(who.userId);
  if (target === null) throw new Error('not registered');
  return target;
}

/** Push jobs queued for a user, oldest first. */
async function queued(userId: string): Promise<PushJob[]> {
  const { rows } = await test.admin.query<{ data: PushJob }>(
    `SELECT data FROM pgboss.job WHERE name = 'push.send' AND data->>'userId' = $1 ORDER BY created_on`,
    [userId],
  );
  return rows.map((row) => row.data);
}

/**
 * Whether the phone takes a box for the server's word: what apps/mobile background-push.ts does
 * with a notice (verifyServerNotice with the keys its build trusts), here with the freshness of a
 * `watch`, the shortest there is.
 */
function phoneAccepts(who: Person, sealed: string): boolean {
  const opened = openPush({ recipient: who.device, sealed, senderIdentityKey: () => null });
  return (
    verifyServerNotice(opened, { keys: trusted, now: Date.now(), maxAgeMs: WATCH_FRESH_MS }) !==
    null
  );
}

/** The device of a member as the other members see it (what Mallory seals for). */
function deviceOf(circle: Circle, who: Person): DevicePublicKeys {
  const bundle = circle.members.find((member) => member.userId === who.userId)?.device?.bundle;
  if (bundle === undefined) throw new Error('no device');
  return verifyDeviceKeyBundle(bundle);
}

/** A member's message for the circle, as the app sends it with an arrival. */
function envelopeOf(who: Person, circle: Circle, payload: Payload): MessageEnvelope {
  const key = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  return encryptMessage({ state: createSenderState(key), sender: who.device, payload }).envelope;
}

const authOf = (who: Person): AuthContext => ({
  userId: who.userId,
  deviceId: who.device.deviceId,
  sessionId: randomUuid(),
  identityKey: who.device.identity.publicKey,
  expiresAt: Date.now() + 60_000,
});

describe('signed server notices (QA-28 B-1)', () => {
  it('signs every notice the server queues, for the recipient’s current device', async () => {
    const [ali, veli, can] = await Promise.all([person(test), person(test), person(test)]);
    await Promise.all([ali, veli, can].map(register));
    // Real paths: a friend request and its acceptance, an invitation and a join, a watch.
    const pair = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    await as(test, veli, 'POST', `/v1/circles/${pair.id}/accept`);
    const group = await createCircle(test, ali);
    await as(test, ali, 'POST', `/v1/circles/${group.id}/members`, { username: can.username });
    await as(test, can, 'POST', `/v1/circles/${group.id}/accept`);
    await test.app.get(RelayService).watch(authOf(can), group.id);

    const worker = workerWith(test.env);
    const seen: string[] = [];
    for (const who of [ali, veli, can]) {
      const target = await targetOf(who);
      for (const job of await queued(who.userId)) {
        if (job.type !== 'notice') continue;
        seen.push(job.notice);
        const sealed = worker.seal(job, target);
        if (sealed === null) throw new Error('not sealed');
        const opened = openPush({ recipient: who.device, sealed, senderIdentityKey: () => null });
        expect(opened.body).toMatchObject({ notice: job.notice, circleId: job.circleId });
        expect(opened.serverSignature?.kid).toBe('test-n1');
        expect(phoneAccepts(who, sealed)).toBe(true);
        // Sealed for this device: another member's phone cannot even open it.
        const other = who === ali ? veli : ali;
        expect(() =>
          openPush({ recipient: other.device, sealed, senderIdentityKey: () => null }),
        ).toThrow();
      }
    }
    expect(seen.sort()).toEqual(
      ['circleInvite', 'friendAccepted', 'friendRequest', 'memberJoined', 'watch'].sort(),
    );
  });

  it.each(PUSH_NOTICES)('the worker signs a queued %s', async (notice) => {
    const who = await person(test);
    await register(who);
    const job: PushJob = { type: 'notice', userId: who.userId, notice, circleId: randomUuid() };
    const sealed = workerWith(test.env).seal(job, await targetOf(who));
    if (sealed === null) throw new Error('not sealed');
    expect(phoneAccepts(who, sealed)).toBe(true);
  });

  it('the QA reproduction: a member’s own watch notice through /v1/place-events moves nothing', async () => {
    const [mallory, bora] = await Promise.all([person(test), person(test)]);
    await Promise.all([mallory, bora].map(register));
    const circle = await circleWith(test, mallory, bora);
    const boraDevice = deviceOf(circle, bora);
    const watch: PushBody = {
      kind: 'notice',
      notice: 'watch',
      circleId: circle.id,
      ts: Date.now(),
    };
    // 1. Unsigned, as anyone could seal it before.
    const forged = sealPush({ recipient: boraDevice, sender: null, body: watch });
    // 2. A genuine watch notice the server sent Mallory's own phone, sealed again for Bora.
    await test.app.get(RelayService).watch(authOf(bora), circle.id);
    const [mine] = (await queued(mallory.userId)).filter(
      (job) => job.type === 'notice' && job.notice === 'watch',
    );
    if (mine === undefined) throw new Error('no watch notice for Mallory');
    const forMallory = workerWith(test.env).seal(mine, await targetOf(mallory));
    if (forMallory === null) throw new Error('not sealed');
    expect(phoneAccepts(mallory, forMallory)).toBe(true);
    const resealed = sealForDevice(boraDevice.dhKey, openSealed(mallory.device, forMallory));

    for (const sealed of [forged, resealed]) {
      const reply = await as(test, mallory, 'POST', '/v1/place-events', {
        envelope: envelopeOf(mallory, circle, {
          kind: 'place_enter',
          placeId: randomUuid(),
          ts: Date.now(),
        }),
        pushes: [{ userId: bora.userId, deviceId: boraDevice.deviceId, sealed }],
      });
      expect(reply.json()).toEqual({ ok: true });
    }
    // The server cannot read members' boxes, so it carries both, unchanged.
    const carried = (await queued(bora.userId)).flatMap((job) =>
      job.type === 'sealed' ? [job] : [],
    );
    expect(carried.map((job) => job.sealed)).toEqual([forged, resealed]);
    const target = await targetOf(bora);
    for (const job of carried) {
      const sealed = workerWith(test.env).seal(job, target);
      if (sealed === null) throw new Error('not sealed');
      // Bora's phone opens a watch notice from it (what an app before the fix acted on)...
      expect(
        openPush({ recipient: bora.device, sealed, senderIdentityKey: () => null }).body,
      ).toMatchObject({ kind: 'notice', notice: 'watch', circleId: circle.id });
      // ...but it is not the server's: dropped, and background live mode never hears of it.
      expect(phoneAccepts(bora, sealed)).toBe(false);
    }
  });

  it('without a notice key the server still sends its notices, unsigned (old apps as before)', async () => {
    const who = await person(test);
    await register(who);
    const job: PushJob = {
      type: 'notice',
      userId: who.userId,
      notice: 'circleInvite',
      circleId: randomUuid(),
    };
    const sealed = workerWith(unsignedEnv).seal(job, await targetOf(who));
    if (sealed === null) throw new Error('not sealed');
    const opened = openPush({ recipient: who.device, sealed, senderIdentityKey: () => null });
    expect(opened.body).toMatchObject({ notice: 'circleInvite' });
    expect(opened.serverSignature).toBeNull();
    expect(phoneAccepts(who, sealed)).toBe(false);
  });
});
