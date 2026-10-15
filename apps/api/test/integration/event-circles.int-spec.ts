import {
  createSenderKeyDistribution,
  createSenderState,
  encryptDocument,
  encryptHistory,
  encryptMessage,
  generateSenderKey,
  randomUuid,
  type SenderState,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  type DocPayload,
  EVENT_DURATION_MS,
  HISTORY_SLOT_MS,
  historySlot,
  type Invite,
  type InvitePreview,
  type MessageEnvelope,
  type Payload,
} from '@bargu/schemas';
import type { PgBoss } from 'pg-boss';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CIRCLE_LIMITS } from '../../src/circles/circles.service.js';
import { EventExpiry } from '../../src/circles/event-expiry.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { QUEUES } from '../../src/jobs/queues.js';
import { JOB_QUEUE } from '../../src/jobs/tokens.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { dumpEverything } from './support/dump.js';
import { exclusively, SWEEP_TIMEOUT_MS } from './support/sweep.js';
import { as, consentToHistory, type Person, person } from './support/people.js';

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
    document(payload: DocPayload): MessageEnvelope {
      const { envelope, nextState } = encryptDocument({ state, sender: who.device, payload });
      state = nextState;
      return envelope;
    },
    trail(from: number): MessageEnvelope {
      const { envelope, nextState } = encryptHistory({
        state,
        sender: who.device,
        payload: { kind: 'trail', from, points: [[0, 4_100_000, 2_900_000, 9]], ts: from },
      });
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

  it('let each person in once per QR code: leaving and coming back needs a new one (QA Faz 8 O6)', async () => {
    const [owner, ayse] = await Promise.all([person(test), person(test)]);
    const event = await createEvent(owner);
    const qr = await qrOf(owner, event);
    expect((await join(ayse, qr)).statusCode).toBe(200);
    const epochOf = async () =>
      (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>().epoch;
    // Asked again while still in (a phone that gave up waiting): the same answer, nothing changes
    // (QA Faz 9 B2).
    const joinedAt = await epochOf();
    const again = await join(ayse, qr);
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ circleId: event.id });
    expect(await epochOf()).toBe(joinedAt);

    expect((await as(test, ayse, 'POST', `/v1/circles/${event.id}/leave`)).statusCode).toBe(204);
    const afterLeaving = await epochOf();
    const back = await join(ayse, qr);
    expect(back.statusCode).toBe(409);
    expect(back.json()).toMatchObject({ code: 'INVITE_USED' });
    // Refused with nothing changed: no new epoch, and the code is not used up by it.
    expect(await epochOf()).toBe(afterLeaving);
    // A new code lets her back.
    expect((await join(ayse, await qrOf(owner, event))).statusCode).toBe(200);
    expect(await epochOf()).toBe(afterLeaving + 1);
  });

  it('take in only so many people an hour, each of whom starts a new epoch (QA Faz 8 O6)', async () => {
    const [owner, late] = await Promise.all([person(test), person(test)]);
    const event = await createEvent(owner);
    const redis = test.app.get<RedisClient>(REDIS);
    // As if a hundred people had come in this hour already.
    await redis.set(`rl:circle-joins:${event.id}`, String(CIRCLE_LIMITS.joinsPerCirclePerHour), {
      EX: 3600,
    });
    const refused = await join(late, await qrOf(owner, event));
    expect(refused.statusCode).toBe(429);
    const circle = (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>();
    expect(circle.members.map((member) => member.userId)).not.toContain(late.userId);
    expect(circle.epoch).toBe(event.epoch);
    // Leaving is never limited.
    expect((await as(test, owner, 'POST', `/v1/circles/${event.id}/leave`)).statusCode).toBe(204);
  });

  it('let their owner close every QR code, whoever made it (QA Faz 8 O2)', async () => {
    const [owner, ayse, bora, stranger, other] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    const event = await createEvent(owner);
    await join(ayse, await qrOf(owner, event));
    await join(bora, await qrOf(owner, event));
    // Ayşe, made an admin too (docs/ADR/0020), makes a QR code of her own; it leaks.
    await as(test, owner, 'POST', `/v1/circles/${event.id}/members/${ayse.userId}/role`, {
      role: 'owner',
    });
    const leaked = await qrOf(ayse, event);
    // Only an admin closes the door; for a member the circle's links are not theirs.
    expect(
      (await as(test, bora, 'POST', `/v1/circles/${event.id}/invites/revoke`)).statusCode,
    ).toBe(404);
    const closed = await as(test, owner, 'POST', `/v1/circles/${event.id}/invites/revoke`);
    expect(closed.statusCode).toBe(200);
    expect(closed.json<{ revoked: number }>().revoked).toBeGreaterThanOrEqual(2);
    expect((await join(stranger, leaked)).statusCode).toBe(404);
    // A new code works again.
    expect((await join(other, await qrOf(owner, event))).statusCode).toBe(200);
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

  it(
    'leave nothing of themselves on the server once they end (BARGU_PLAN Faz 8 DoD)',
    () =>
      exclusively(test, async () => {
        const { circle, qr } = await eventWithEverything();
        // Before: the circle is all over the place.
        expect(await dumpEverything(test)).toContain(circle.id);

        // The event ends (as if its time had come), the worker sweeps.
        await endOnTime(circle.id);
        expect(await test.app.get(EventExpiry).sweep()).toBeGreaterThanOrEqual(1);

        const after = await dumpEverything(test);
        expect(after).not.toContain(circle.id);
        // The phones were told to reload their circles (an event that names no circle).
        expect(after).toContain('circles.reload');
        // And the QR code no longer lets anyone in.
        const late = await person(test);
        expect((await join(late, qr)).statusCode).toBe(404);
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'leave nothing either when a notice about them failed for good (dead letter queue)',
    () =>
      exclusively(test, async () => {
        const { circle } = await eventWithEverything();
        // Every queued notice fails for good (a permanent FCM or APNs refusal): pg-boss copies it to
        // the dead letter queue, payload and all.
        const boss = test.app.get<PgBoss>(JOB_QUEUE);
        await test.admin.query(`UPDATE pgboss.job SET retry_count = retry_limit WHERE name = $1`, [
          QUEUES.push,
        ]);
        const jobs = await boss.fetch(QUEUES.push, { batchSize: 100 });
        expect(jobs.length).toBeGreaterThan(0);
        await boss.fail(
          QUEUES.push,
          jobs.map((job) => job.id),
        );
        const { rows } = await test.admin.query(
          `SELECT 1 FROM pgboss.job WHERE name = $1 AND data->>'circleId' = $2`,
          [QUEUES.pushDead, circle.id],
        );
        expect(rows.length).toBeGreaterThan(0);

        await endOnTime(circle.id);
        await test.app.get(EventExpiry).sweep();
        expect(await dumpEverything(test)).not.toContain(circle.id);
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'leave nothing either when the clean-up is cut short: the next sweep finishes it',
    () =>
      exclusively(test, async () => {
        const { circle } = await eventWithEverything();
        await endOnTime(circle.id);
        // Redis fails once, after the database already let the circle go.
        const redis = test.app.get<RedisClient>(REDIS);
        const del = vi.spyOn(redis, 'del').mockRejectedValueOnce(new Error('redis hiccup'));
        const expiry = test.app.get(EventExpiry);
        await expect(expiry.sweep()).rejects.toThrow('redis hiccup');
        del.mockRestore();
        // What is left waits for the next round, which finishes it.
        expect(await dumpEverything(test)).toContain(circle.id);
        await expiry.sweep();
        const after = await dumpEverything(test);
        expect(after).not.toContain(circle.id);
        expect(after).toContain('circles.reload');
      }),
    SWEEP_TIMEOUT_MS,
  );

  it(
    'end early for their owner even when the clean-up has to wait for the next round',
    () =>
      exclusively(test, async () => {
        const [owner, ayse] = await Promise.all([person(test), person(test)]);
        const event = await createEvent(owner);
        await join(ayse, await qrOf(owner, event));
        const redis = test.app.get<RedisClient>(REDIS);
        const del = vi.spyOn(redis, 'del').mockRejectedValueOnce(new Error('redis hiccup'));
        expect((await as(test, owner, 'POST', `/v1/circles/${event.id}/end`)).statusCode).toBe(204);
        del.mockRestore();
        await test.app.get(EventExpiry).sweep();
        expect(await dumpEverything(test)).not.toContain(event.id);
      }),
    SWEEP_TIMEOUT_MS,
  );
});

/** An event with everything it can hold, written by its two members. */
async function eventWithEverything(): Promise<{ circle: Circle; qr: Invite }> {
  const [owner, ayse] = await Promise.all([person(test), person(test)]);
  const event = await createEvent(owner);
  const qr = await qrOf(owner, event);
  await join(ayse, qr);
  const circle = (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>();

  // Everything the circle can hold: keys, a location, a status, a profile, a place, a meeting,
  // a piece of history, a poke,
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
  const meeting = await as(test, owner, 'PUT', `/v1/circles/${circle.id}/docs/${circle.id}`, {
    envelope: ownerPhone.document({
      kind: 'plan',
      id: circle.id,
      meetAt: now + HOUR,
      placeId,
      ts: now,
    }),
    version: null,
    kind: 'plan',
    pollId: null,
  });
  expect(meeting.statusCode).toBe(200);
  const slot = historySlot(now) - HISTORY_SLOT_MS;
  await consentToHistory(test, owner);
  const piece = await as(test, owner, 'PUT', `/v1/circles/${circle.id}/history/${String(slot)}`, {
    envelope: ownerPhone.trail(slot),
  });
  expect(piece.statusCode).toBe(204);
  await as(test, owner, 'POST', '/v1/bumps', {
    envelope: ownerPhone.seal({ kind: 'bump', ts: now }),
  });

  return { circle, qr };
}

/** The event's end has come (as if its time had passed). */
async function endOnTime(circleId: string): Promise<void> {
  await test.admin.query(
    `UPDATE app.circles SET expires_at = now() - interval '1 second' WHERE id = $1`,
    [circleId],
  );
}
