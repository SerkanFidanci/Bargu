import {
  createSenderState,
  encryptMessage,
  generateSenderKey,
  randomUuid,
  sealPush,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import type { Circle, MessageEnvelope, Payload } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { pushTokens } from '../../src/db/schema.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { PushTokens } from '../../src/push/push-tokens.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { call } from './support/client.js';
import { as, circleWith, createCircle, type Person, person } from './support/people.js';

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
const privateKey = await testPrivateKeyPem();
const account = Buffer.from(
  JSON.stringify({
    type: 'service_account',
    project_id: 'bargu-test',
    client_email: 'push@bargu-test.iam.gserviceaccount.com',
    private_key: privateKey,
  }),
).toString('base64');

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp({ env: testEnv({ FCM_SERVICE_ACCOUNT: account }) });
});
afterAll(async () => {
  await test.close();
});

const register = (who: Person, token: string) =>
  as(test, who, 'PUT', '/v1/push', { token, platform: 'android', locale: 'tr' });

/** Push jobs queued for a user: what the worker will send (no names, no text, no token). */
async function queued(userId: string): Promise<unknown[]> {
  const { rows } = await test.admin.query<{ data: unknown }>(
    `SELECT data FROM pgboss.job WHERE name = 'push.send' AND data->>'userId' = $1`,
    [userId],
  );
  return rows.map((row) => row.data);
}

describe('push tokens', () => {
  it('are kept per device, sealed at rest, and readable by their owner only', async () => {
    const [ali, stranger] = await Promise.all([person(test), person(test)]);
    expect((await register(ali, 'fcm-token-of-ali')).statusCode).toBe(204);

    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(p)::text AS dump FROM app.push_tokens p WHERE device_id = $1`,
      [ali.device.deviceId],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.dump).not.toContain('fcm-token-of-ali');
    expect(await test.app.get(PushTokens).targetOf(ali.userId)).toMatchObject({
      token: 'fcm-token-of-ali',
      locale: 'tr',
    });

    const seen = await test.app
      .get(DatabaseService)
      .asUser(stranger.userId, (tx) => tx.select().from(pushTokens));
    expect(seen).toEqual([]);

    // A new token replaces the old one.
    await register(ali, 'fcm-token-of-ali-2');
    expect((await test.app.get(PushTokens).targetOf(ali.userId))?.token).toBe('fcm-token-of-ali-2');
  });

  it('refuse unsigned and malformed registrations', async () => {
    const ali = await person(test);
    const unsigned = await call(test.app, {
      method: 'PUT',
      url: '/v1/push',
      accessToken: ali.session.accessToken,
      body: { token: 'x', platform: 'android', locale: 'tr' },
    });
    expect(unsigned.statusCode).toBe(401);
    for (const body of [
      { token: '', platform: 'android', locale: 'tr' },
      { token: 'x', platform: 'web', locale: 'tr' },
      { token: 'x', platform: 'android', locale: 'de' },
      { token: 'x', platform: 'android', locale: 'tr', extra: 1 },
    ]) {
      expect((await as(test, ali, 'PUT', '/v1/push', body)).statusCode).toBe(400);
    }
  });

  it('stop when the phone signs out or the user turns them off', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    await register(ali, 'token-a');
    await register(veli, 'token-v');
    expect((await as(test, ali, 'DELETE', '/v1/push')).statusCode).toBe(204);
    expect(await test.app.get(PushTokens).targetOf(ali.userId)).toBeNull();
    await call(test.app, {
      url: '/v1/auth/logout',
      accessToken: veli.session.accessToken,
      device: veli.device,
    });
    expect(await test.app.get(PushTokens).targetOf(veli.userId)).toBeNull();
  });
});

describe('push notifications', () => {
  it('are queued for requests, acceptances, invitations and joins: kind and circle only', async () => {
    const [ali, veli, can] = await Promise.all([person(test), person(test), person(test)]);
    const pair = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    expect(await queued(veli.userId)).toEqual([
      { type: 'notice', userId: veli.userId, notice: 'friendRequest', circleId: pair.id },
    ]);
    await as(test, veli, 'POST', `/v1/circles/${pair.id}/accept`);
    expect(await queued(ali.userId)).toEqual([
      { type: 'notice', userId: ali.userId, notice: 'friendAccepted', circleId: pair.id },
    ]);

    const group = await createCircle(test, ali);
    await as(test, ali, 'POST', `/v1/circles/${group.id}/members`, { username: can.username });
    expect(await queued(can.userId)).toEqual([
      { type: 'notice', userId: can.userId, notice: 'circleInvite', circleId: group.id },
    ]);
    await as(test, can, 'POST', `/v1/circles/${group.id}/accept`);
    expect(await queued(ali.userId)).toContainEqual({
      type: 'notice',
      userId: ali.userId,
      notice: 'memberJoined',
      circleId: group.id,
    });
    // The one acting is never notified of their own doing.
    expect(await queued(can.userId)).toHaveLength(1);
  });

  it('do not pile up: the same news about the same circle once a minute', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    for (let i = 0; i < 3; i++) {
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username });
    }
    expect(await queued(veli.userId)).toHaveLength(1);
  });
});

describe('sealed notifications from members (pokes, arrivals)', () => {
  /** Only what members' phones sealed (circle news queued along the way are notices). */
  const sealedFor = async (userId: string) =>
    (await queued(userId)).filter(
      (job) => typeof job === 'object' && job !== null && 'type' in job && job.type === 'sealed',
    );

  /** A member's message for the circle, as the app sends it with a poke or an arrival. */
  function envelopeOf(who: Person, circle: Circle, payload: Payload): MessageEnvelope {
    const key = generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    });
    return encryptMessage({ state: createSenderState(key), sender: who.device, payload }).envelope;
  }

  it('reach offline members only, sealed, and never anyone outside the circle', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const boraDevice = circle.members.find((member) => member.userId === bora.userId)?.device;
    if (boraDevice === undefined || boraDevice === null) throw new Error('no device');
    const toBora = sealPush({
      recipient: verifyDeviceKeyBundle(boraDevice.bundle),
      sender: ayse.device,
      body: {
        kind: 'place',
        circleId: circle.id,
        placeId: randomUuid(),
        event: 'enter',
        name: 'Bizim ev',
        emoji: '🏠',
        ts: Date.now(),
      },
    });
    const pushes = [
      { userId: bora.userId, deviceId: boraDevice.bundle.deviceId, sealed: toBora },
      // Not a member: the server drops it instead of waking a stranger's phone.
      { userId: mallory.userId, deviceId: mallory.device.deviceId, sealed: toBora },
      // Ayşe herself is not among the others.
      { userId: ayse.userId, deviceId: ayse.device.deviceId, sealed: toBora },
    ];
    const reply = await as(test, ayse, 'POST', '/v1/place-events', {
      envelope: envelopeOf(ayse, circle, {
        kind: 'place_enter',
        placeId: randomUuid(),
        ts: Date.now(),
      }),
      pushes,
    });
    expect(reply.json()).toEqual({ ok: true });
    expect(await sealedFor(bora.userId)).toEqual([
      { type: 'sealed', userId: bora.userId, deviceId: boraDevice.bundle.deviceId, sealed: toBora },
    ]);
    expect(await sealedFor(mallory.userId)).toEqual([]);
    expect(await sealedFor(ayse.userId)).toEqual([]);
    // Nothing readable about the arrival anywhere in the queue.
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT data::text AS dump FROM pgboss.job WHERE name = 'push.send'`,
    );
    for (const row of rows) expect(row.dump).not.toMatch(/Bizim ev|place|enter/);

    // A poke carries its sealed notification the same way.
    await as(test, ayse, 'POST', '/v1/bumps', {
      envelope: envelopeOf(ayse, circle, { kind: 'bump', ts: Date.now() }),
      pushes: [pushes[0]],
    });
    expect(await sealedFor(bora.userId)).toHaveLength(2);

    // An outsider's message is refused, and with it its notifications.
    const outsider = await as(test, mallory, 'POST', '/v1/place-events', {
      envelope: envelopeOf(mallory, circle, {
        kind: 'place_exit',
        placeId: randomUuid(),
        ts: Date.now(),
      }),
      pushes: [pushes[0]],
    });
    expect(outsider.json()).toEqual({ refused: 'NOT_MEMBER' });
    expect(await sealedFor(bora.userId)).toHaveLength(2);
  });
});
