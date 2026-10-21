import {
  generateRequestNonce,
  openPush,
  randomUuid,
  signRequest,
  type DeviceKeys,
} from '@bargu/crypto';
import type { Circle } from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthContext } from '../../src/auth/request-context.js';
import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import type { PushJob } from '../../src/push/notifier.js';
import { PushTokens } from '../../src/push/push-tokens.js';
import { sealedFor } from '../../src/push/push.worker.js';
import { WatchNotices } from '../../src/push/watch-notices.js';
import { RelayService } from '../../src/relay/relay.service.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { login } from './support/client.js';
import { as, circleWith, type Person, person } from './support/people.js';

/**
 * Background live mode, the server's half (docs/ADR/0028 step 3): when someone looks at a circle,
 * the members whose app is closed get a silent, sealed `watch` notice that names the circle and
 * nobody else.
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

let on: TestApp;
let off: TestApp;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  on = await createTestApp({
    env: testEnv({ FCM_SERVICE_ACCOUNT: account, WATCH_PUSH: 'on', BILLING_TEST: 'on' }),
  });
  await on.app.listen(0, '127.0.0.1');
  url = await on.app.getUrl();
  // Left at its default: off.
  off = await createTestApp({ env: testEnv({ FCM_SERVICE_ACCOUNT: account }) });
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await on.close();
  await off.close();
});

function connect(who: Person): Promise<Socket> {
  const nonce = generateRequestNonce();
  const ts = Date.now();
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      path: EVENTS_PATH,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      auth: {
        token: who.session.accessToken,
        ts: String(ts),
        nonce,
        sig: signRequest(who.device.identity.secretKey, {
          method: 'GET',
          path: EVENTS_PATH,
          timestamp: ts,
          nonce,
          deviceId: who.device.deviceId,
          body: new Uint8Array(0),
        }),
      },
    });
    sockets.push(socket);
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', reject);
  });
}

const authOf = (who: Person): AuthContext => ({
  userId: who.userId,
  deviceId: who.device.deviceId,
  sessionId: randomUuid(),
  identityKey: who.device.identity.publicKey,
  expiresAt: Date.now() + 60_000,
});

/** Push jobs queued for a user: what the worker will send (no token, no text). */
async function queued(test: TestApp, userId: string): Promise<PushJob[]> {
  const { rows } = await test.admin.query<{ data: PushJob }>(
    `SELECT data FROM pgboss.job WHERE name = 'push.send' AND data->>'userId' = $1 ORDER BY created_on`,
    [userId],
  );
  return rows.map((row) => row.data);
}

const watchJobs = async (test: TestApp, userId: string) =>
  (await queued(test, userId)).filter((job) => job.type === 'notice' && job.notice === 'watch');

/** A watcher's own limit (2 in 30 s per circle) as if the time had passed. */
const expireWatcher = async (test: TestApp, who: Person, circleId: string) => {
  await test.app.get<RedisClient>(REDIS).del(`rl:watch:${who.userId}:${circleId}`);
};

const watchNotices = () => on.app.get(WatchNotices);
/** Just over the 90 seconds a recipient must wait between two notices. */
const GAP = 91_000;
const HOUR = 3_600_000;

/** The device a notice would be sealed for, as the worker knows it. */
const targetOf = (userId: string, device: DeviceKeys) => ({
  userId,
  deviceId: device.deviceId,
  dhKey: device.dh.publicKey,
  platform: 'android' as const,
  token: 'device-token',
  locale: 'tr' as const,
});

describe('the silent watch notice (docs/ADR/0028 step 3)', () => {
  it('goes to the circle’s offline members only: never the watcher, never a connected member', async () => {
    const [ayse, bora, can] = await Promise.all([person(on), person(on), person(on)]);
    const circle = await circleWith(on, ayse, bora, can);
    const [ayseSocket] = await Promise.all([connect(ayse), connect(can)]);
    // Bora's app is closed; Can's is open (he gets the live `watch` event instead).
    expect(await ayseSocket.emitWithAck('watch', { circleId: circle.id })).toEqual({ ok: true });

    expect(await watchJobs(on, bora.userId)).toEqual([
      { type: 'notice', userId: bora.userId, notice: 'watch', circleId: circle.id },
    ]);
    expect(await watchJobs(on, can.userId)).toEqual([]);
    expect(await watchJobs(on, ayse.userId)).toEqual([]);
  });

  it('opens to the kind and the circle and nothing else: no watcher, device or signature anywhere', async () => {
    const [ayse, bora] = await Promise.all([person(on, 'Ayse Gozcu'), person(on)]);
    const circle = await circleWith(on, ayse, bora);
    await on.app.get(RelayService).watch(authOf(ayse), circle.id);

    const [job] = await watchJobs(on, bora.userId);
    if (job === undefined) throw new Error('no notice queued');
    // The queued job: the recipient and the circle.
    expect(Object.keys(job).sort()).toEqual(['circleId', 'notice', 'type', 'userId']);

    // Unsigned here (no notice key): signing is server-notices.int-spec's.
    const sealed = sealedFor(job, targetOf(bora.userId, bora.device), null, 1_800_000_000_000);
    if (sealed === null) throw new Error('not sealed');
    const opened = openPush({
      recipient: bora.device,
      sealed,
      senderIdentityKey: () => null,
    });
    // Server news: no sender device, and the content is the kind and the circle.
    expect(opened.senderDeviceId).toBeNull();
    expect(opened.body).toEqual({
      kind: 'notice',
      notice: 'watch',
      circleId: circle.id,
      ts: 1_800_000_000_000,
    });
    const everything = JSON.stringify([job, opened]);
    for (const secret of [
      ayse.userId,
      ayse.device.deviceId,
      ayse.username,
      'Ayse Gozcu',
      ayse.email,
    ]) {
      expect(everything).not.toContain(secret);
    }
    // The sealed text itself is ciphertext: nothing readable in it either.
    expect(sealed).not.toContain(circle.id);
    // Nor anywhere in the queue.
    const { rows } = await on.admin.query<{ dump: string }>(
      `SELECT data::text AS dump FROM pgboss.job WHERE name = 'push.send' AND data->>'userId' = $1`,
      [bora.userId],
    );
    for (const row of rows) expect(row.dump).not.toContain(ayse.userId);
  });

  it('is sealed for the member’s current device only', async () => {
    const [ayse, bora] = await Promise.all([person(on), person(on)]);
    const circle = await circleWith(on, ayse, bora);
    const tokens = on.app.get(PushTokens);
    await as(on, bora, 'PUT', '/v1/push', {
      token: 'token-old',
      platform: 'android',
      locale: 'tr',
    });
    // Bora signs in on a new phone: the old one is revoked and the new one registers.
    const next = await login(on, bora.email);
    const boraNow: Person = { ...bora, session: next.session, device: next.device };
    await as(on, boraNow, 'PUT', '/v1/push', {
      token: 'token-new',
      platform: 'android',
      locale: 'tr',
    });

    await on.app.get(RelayService).watch(authOf(ayse), circle.id);
    const [job] = await watchJobs(on, bora.userId);
    if (job === undefined) throw new Error('no notice queued');
    const target = await tokens.targetOf(bora.userId);
    expect(target?.deviceId).toBe(next.device.deviceId);
    if (target === null) throw new Error('no target');
    const sealed = sealedFor(job, target, null);
    if (sealed === null) throw new Error('not sealed');
    expect(
      openPush({ recipient: next.device, sealed, senderIdentityKey: () => null }).body,
    ).toMatchObject({ notice: 'watch', circleId: circle.id });
    // The old phone cannot open it.
    expect(() =>
      openPush({ recipient: bora.device, sealed, senderIdentityKey: () => null }),
    ).toThrow();
  });

  it('is not sent for a circle that is paused, nor for a stranger watching', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(on), person(on), person(on)]);
    const circle = await circleWith(on, ayse, bora);
    const [ayseSocket, mallorySocket] = await Promise.all([connect(ayse), connect(mallory)]);

    // A stranger: not found, and nothing queued for anyone in the circle.
    expect(await mallorySocket.emitWithAck('watch', { circleId: circle.id })).toEqual({
      error: 'NOT_FOUND',
    });
    expect(await watchJobs(on, bora.userId)).toEqual([]);
    expect(await watchJobs(on, ayse.userId)).toEqual([]);
    expect(await watchJobs(on, mallory.userId)).toEqual([]);
    // A circle that does not exist is no different.
    expect(await mallorySocket.emitWithAck('watch', { circleId: randomUuid() })).toEqual({
      error: 'NOT_FOUND',
    });

    // Nobody keeps the circle open (both trials end): watching it is refused, nothing is sent.
    for (const who of [ayse, bora]) {
      const ended = await as(on, who, 'POST', '/v1/billing/test/simulate', { action: 'endTrial' });
      expect(ended.statusCode).toBe(200);
    }
    const paused = (await as(on, ayse, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(paused.paused).toBe(true);
    expect(await ayseSocket.emitWithAck('watch', { circleId: circle.id })).toEqual({
      error: 'CIRCLE_PAUSED',
    });
    expect(await watchJobs(on, bora.userId)).toEqual([]);
  });

  it('reaches a recipient once every 90 seconds, however many watch', async () => {
    const [ayse, can, bora] = await Promise.all([person(on), person(on), person(on)]);
    const circle = await circleWith(on, ayse, can, bora);
    const relay = on.app.get(RelayService);

    // Two watchers within the window: one notice for Bora (Can is told once for Ayşe's look).
    await relay.watch(authOf(ayse), circle.id);
    await relay.watch(authOf(can), circle.id);
    expect(await watchJobs(on, bora.userId)).toHaveLength(1);
    expect(await watchJobs(on, can.userId)).toHaveLength(1);
    // A watcher renewing every minute adds nothing inside the window.
    await expireWatcher(on, ayse, circle.id);
    await relay.watch(authOf(ayse), circle.id);
    expect(await watchJobs(on, bora.userId)).toHaveLength(1);
    // 90 seconds later it is allowed again, whoever watches.
    const later = Date.now() + GAP;
    expect(await watchNotices().tell(circle.id, [bora.userId], later - 2_000)).toEqual([]);
    expect(await watchNotices().tell(circle.id, [bora.userId], later)).toEqual([bora.userId]);
    expect(await watchJobs(on, bora.userId)).toHaveLength(2);
  });

  it('is counted per recipient: another member of the circle is told on their own account', async () => {
    const [ayse, bora, can] = await Promise.all([person(on), person(on), person(on)]);
    const circle = await circleWith(on, ayse, bora, can);
    await on.app.get(RelayService).watch(authOf(ayse), circle.id);
    expect(await watchJobs(on, bora.userId)).toHaveLength(1);
    expect(await watchJobs(on, can.userId)).toHaveLength(1);
    // Bora's gap is over, Can's is not.
    await watchNotices().tell(circle.id, [bora.userId], Date.now() + GAP);
    expect(await watchJobs(on, bora.userId)).toHaveLength(2);
    expect(await watchJobs(on, can.userId)).toHaveLength(1);
  });

  it('is at most 20 in any hour, not 20 in a clock hour: no burst of 40 across a window edge', async () => {
    const circleId = randomUuid();
    const recipient = randomUuid();
    const start = Date.now();
    const told: number[] = [];
    const attempt = async (at: number) => {
      if ((await watchNotices().tell(circleId, [recipient], start + at)).length > 0) told.push(at);
    };
    // One notice, a quiet half hour, then someone watches all the time (a try every 91 seconds).
    // A fixed hour starting at the first notice would let 19 more through before its end and 20
    // right after it: 39 in under an hour.
    await attempt(0);
    for (let at = HOUR / 2; at <= 3 * HOUR; at += GAP) await attempt(at);
    for (let index = 1; index < told.length; index += 1) {
      expect((told[index] ?? 0) - (told[index - 1] ?? 0)).toBeGreaterThanOrEqual(90_000);
    }
    for (const at of told) {
      expect(told.filter((other) => other > at - HOUR && other <= at).length).toBeLessThanOrEqual(
        20,
      );
    }
    // It lets traffic through all the same: about 20 an hour, for as long as they watch.
    expect(told.length).toBeGreaterThanOrEqual(50);
    expect(await watchJobs(on, recipient)).toHaveLength(told.length);
  });

  it('forgets nothing it refused: at the limit, the next notice comes as soon as one ages out', async () => {
    const circleId = randomUuid();
    const recipient = randomUuid();
    const start = Date.now();
    for (let index = 0; index < 20; index += 1) {
      expect(await watchNotices().tell(circleId, [recipient], start + index * GAP)).toEqual([
        recipient,
      ]);
    }
    // The twentieth was at 19 × 91 s; refusals along the way do not push the hour out.
    for (let at = 20 * GAP; at < HOUR; at += GAP) {
      expect(await watchNotices().tell(circleId, [recipient], start + at)).toEqual([]);
    }
    // The first one is an hour old: there is room for exactly one more.
    expect(await watchNotices().tell(circleId, [recipient], start + HOUR)).toEqual([recipient]);
    expect(await watchNotices().tell(circleId, [recipient], start + HOUR + 1_000)).toEqual([]);
    expect(await watchJobs(on, recipient)).toHaveLength(21);
  });

  it('is not sent at all while the server switch is off, the live event still goes', async () => {
    const [ayse, bora] = await Promise.all([person(off), person(off)]);
    const circle = await circleWith(off, ayse, bora);
    await off.app.get(RelayService).watch(authOf(ayse), circle.id);
    expect(await watchJobs(off, bora.userId)).toEqual([]);
    expect(await watchJobs(off, ayse.userId)).toEqual([]);
  });
});
