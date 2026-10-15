import {
  createSenderKeyDistribution,
  createSenderState,
  encryptMessage,
  generateSenderKey,
  randomUuid,
  type SenderState,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  EVENT_DURATION_MS,
  type Invite,
  type InvitePreview,
  type MessageEnvelope,
  type Payload,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventExpiry } from '../../src/circles/event-expiry.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { as, type Person, person } from './support/people.js';

/** A throwaway RSA key in PEM (WebCrypto): notices get queued, nothing is sent to Google. */
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
  return `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`;
}

let test: TestApp;

beforeAll(async () => {
  const account = Buffer.from(
    JSON.stringify({
      type: 'service_account',
      project_id: 'bargu-test',
      client_email: 'push@bargu-test.iam.gserviceaccount.com',
      private_key: await testPrivateKeyPem(),
    }),
  ).toString('base64');
  test = await createTestApp({ env: testEnv({ FCM_SERVICE_ACCOUNT: account }) });
});
afterAll(async () => {
  await test.close();
});

const HOUR = 3600_000;

async function createEvent(owner: Person, endsAt = Date.now() + 3 * HOUR): Promise<Circle> {
  const response = await as(test, owner, 'POST', '/v1/circles', {
    kind: 'event',
    name: 'Konser',
    endsAt,
  });
  if (response.statusCode !== 201) throw new Error(`create event: ${response.body}`);
  return response.json<Circle>();
}

async function qrOf(owner: Person, circle: Circle): Promise<Invite> {
  return (
    await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
  ).json<Invite>();
}

const join = (who: Person, invite: Invite) =>
  as(test, who, 'POST', '/v1/invites/accept', { token: invite.token });

/** A member's phone: its sender key for the circle's epoch. */
function phone(who: Person, circle: Circle) {
  let state: SenderState = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  return {
    key: state.senderKey,
    seal(payload: Payload): MessageEnvelope {
      const { envelope, nextState } = encryptMessage({ state, sender: who.device, payload });
      state = nextState;
      return envelope;
    },
  };
}

describe('event circles', () => {
  it('end between a quarter of an hour and a week from now; groups have no end', async () => {
    const owner = await person(test);
    const now = Date.now();
    for (const endsAt of [now + 5 * 60_000, now + EVENT_DURATION_MS.max + HOUR]) {
      const response = await as(test, owner, 'POST', '/v1/circles', {
        kind: 'event',
        name: 'Konser',
        endsAt,
      });
      expect(response.statusCode).toBe(400);
    }
    const endsAt = now + 2 * HOUR;
    expect((await createEvent(owner, endsAt)).expiresAt).toBe(endsAt);
    const group = (
      await as(test, owner, 'POST', '/v1/circles', { kind: 'friends', name: 'Ekip' })
    ).json<Circle>();
    expect(group.expiresAt).toBeUndefined();
    // An end cannot be smuggled into a group.
    const smuggled = await as(test, owner, 'POST', '/v1/circles', {
      kind: 'friends',
      name: 'Ekip',
      endsAt,
    });
    expect(smuggled.statusCode).toBe(400);
  });

  it('let many people join with one QR code until the event ends', async () => {
    const [owner, ayse, bora, can] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    const event = await createEvent(owner);
    const qr = await qrOf(owner, event);
    expect(qr.expiresAt).toBe(event.expiresAt);

    const preview = (
      await as(test, ayse, 'POST', '/v1/invites/preview', { token: qr.token })
    ).json<InvitePreview>();
    expect(preview.circle).toMatchObject({
      kind: 'event',
      name: 'Konser',
      expiresAt: event.expiresAt,
    });

    for (const who of [ayse, bora, can]) {
      const joined = await join(who, qr);
      expect(joined.statusCode).toBe(200);
    }
    const circle = (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>();
    expect(circle.members.filter((member) => member.status === 'active')).toHaveLength(4);

    // A group's link still works once.
    const group = (
      await as(test, owner, 'POST', '/v1/circles', { kind: 'family', name: 'Aile' })
    ).json<Circle>();
    const link = await qrOf(owner, group);
    expect((await join(ayse, link)).statusCode).toBe(200);
    expect((await join(bora, link)).statusCode).toBe(404);
  });

  it('can be ended early by its owner only', async () => {
    const [owner, ayse] = await Promise.all([person(test), person(test)]);
    const event = await createEvent(owner);
    await join(ayse, await qrOf(owner, event));

    expect((await as(test, ayse, 'POST', `/v1/circles/${event.id}/end`)).statusCode).toBe(404);
    expect((await as(test, owner, 'POST', `/v1/circles/${event.id}/end`)).statusCode).toBe(204);
    for (const who of [owner, ayse]) {
      expect((await as(test, who, 'GET', `/v1/circles/${event.id}`)).statusCode).toBe(404);
      const circles = (await as(test, who, 'GET', '/v1/circles')).json<{ circles: Circle[] }>();
      expect(circles.circles.map((circle) => circle.id)).not.toContain(event.id);
    }
    // A group cannot be "ended".
    const group = (
      await as(test, owner, 'POST', '/v1/circles', { kind: 'friends', name: 'Ekip' })
    ).json<Circle>();
    expect((await as(test, owner, 'POST', `/v1/circles/${group.id}/end`)).statusCode).toBe(404);
  });

  it('leave nothing of themselves on the server once they end (BARGU_PLAN Faz 8 DoD)', async () => {
    const [owner, ayse] = await Promise.all([person(test), person(test)]);
    const event = await createEvent(owner);
    const qr = await qrOf(owner, event);
    await join(ayse, qr);
    const circle = (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>();

    // Everything the circle can hold: keys, a location, a status, a profile, a place, a poke,
    // an invite, queued notices, events in both members' streams.
    for (const [who, other] of [
      [owner, ayse],
      [ayse, owner],
    ] as const) {
      const member = circle.members.find((candidate) => candidate.userId === other.userId);
      const device = member?.device;
      if (device === undefined || device === null) throw new Error('no device');
      const senderKey = generateSenderKey({
        circleId: circle.id,
        epoch: circle.epoch,
        senderDeviceId: who.device.deviceId,
      });
      const upload = await as(test, who, 'POST', `/v1/circles/${circle.id}/keys`, {
        epoch: circle.epoch,
        distributions: [
          createSenderKeyDistribution({
            senderKey,
            sender: who.device,
            recipient: verifyDeviceKeyBundle(device.bundle),
          }),
        ],
      });
      expect(upload.statusCode).toBe(204);
    }
    const ownerPhone = phone(owner, circle);
    const now = Date.now();
    await as(test, owner, 'POST', '/v1/locations', {
      envelopes: [
        ownerPhone.seal({
          kind: 'loc',
          lat: 41.0,
          lng: 29.0,
          acc: 8,
          bat: 50,
          chg: false,
          ts: now,
        }),
      ],
    });
    await as(test, owner, 'POST', '/v1/statuses', {
      envelopes: [ownerPhone.seal({ kind: 'status', emoji: '🎸', expiresAt: now + HOUR, ts: now })],
      ttlSeconds: 3600,
    });
    await as(test, owner, 'POST', '/v1/profile-keys', {
      envelopes: [ownerPhone.seal({ kind: 'profile', photo: null, ts: now })],
    });
    const placeId = randomUuid();
    const place = await as(test, owner, 'PUT', `/v1/circles/${circle.id}/places/${placeId}`, {
      envelope: ownerPhone.seal({
        kind: 'place',
        id: placeId,
        name: 'Sahne',
        emoji: '🎸',
        lat: 41.0,
        lng: 29.0,
        radius: 100,
        ts: now,
      }),
      version: null,
    });
    expect(place.statusCode).toBe(200);
    await as(test, owner, 'POST', '/v1/bumps', {
      envelope: ownerPhone.seal({ kind: 'bump', ts: now }),
    });

    // Before: the circle is all over the place.
    const before = await everything();
    expect(before).toContain(circle.id);

    // The event ends (as if its time had come), the worker sweeps.
    await test.admin.query(
      `UPDATE app.circles SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [circle.id],
    );
    expect(await test.app.get(EventExpiry).sweep()).toBeGreaterThanOrEqual(1);

    const after = await everything();
    expect(after).not.toContain(circle.id);
    // The phones were told to reload their circles (an event that names no circle).
    expect(after).toContain('circles.reload');
    // And the QR code no longer lets anyone in.
    const late = await person(test);
    expect((await join(late, qr)).statusCode).toBe(404);
  });
});

/** Every table of the app and the job queue, every Redis key and value, as one text. */
async function everything(): Promise<string> {
  const parts: string[] = [];
  const { rows: tables } = await test.admin.query<{ name: string }>(
    `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables
      WHERE schemaname IN ('app', 'pgboss')`,
  );
  for (const { name } of tables) {
    const { rows } = await test.admin.query<{ dump: string | null }>(
      `SELECT json_agg(t)::text AS dump FROM ${name} t`,
    );
    parts.push(rows[0]?.dump ?? '');
  }
  const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
  await redis.connect();
  try {
    for await (const keys of redis.scanIterator({ COUNT: 500 })) {
      for (const key of keys) {
        parts.push(key);
        const type = await redis.type(key);
        if (type === 'string') parts.push((await redis.get(key)) ?? '');
        if (type === 'hash') parts.push(JSON.stringify(await redis.hGetAll(key)));
        if (type === 'stream') parts.push(JSON.stringify(await redis.xRange(key, '-', '+')));
        if (type === 'list') parts.push(JSON.stringify(await redis.lRange(key, 0, -1)));
        if (type === 'set') parts.push(JSON.stringify(await redis.sMembers(key)));
        if (type === 'zset') parts.push(JSON.stringify(await redis.zRange(key, 0, -1)));
      }
    }
  } finally {
    await redis.close();
  }
  return parts.join('\n');
}
