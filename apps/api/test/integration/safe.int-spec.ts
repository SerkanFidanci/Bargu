import { Writable } from 'node:stream';

import {
  createSenderState,
  decryptMessage,
  encryptMessage,
  generateMessageId,
  generateRequestNonce,
  generateSenderKey,
  openPush,
  ReplayGuard,
  sealPush,
  type SenderKey,
  type SenderState,
  signRequest,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  type DevicePushes,
  type Invite,
  type MessageEnvelope,
  type Payload,
  type Plan,
  type SafePayload,
} from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { Notifier } from '../../src/push/notifier.js';
import { SAFE_GUARD_SECONDS } from '../../src/relay/relay.service.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { call } from './support/client.js';
import { dumpEverything } from './support/dump.js';
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
const account = Buffer.from(
  JSON.stringify({
    type: 'service_account',
    project_id: 'bargu-test',
    client_email: 'push@bargu-test.iam.gserviceaccount.com',
    private_key: await testPrivateKeyPem(),
  }),
).toString('base64');

// Somewhere in Ankara, and a name and words: none of them may reach the server through this.
const LAT = 39.920_771;
const LNG = 32.854_027;
const NAME = 'Zeynepcan Aydoğdu';
const COORDINATE_LEAKS: readonly (readonly [string, RegExp])[] = [
  ['39.920', /(?<!\d)(?<!\d:)39\.920/],
  ['32.854', /(?<!\d)(?<!\d:)32\.854/],
  ['39,920', /(?<!\d)(?<!\d:)39,920/],
  ['32,854', /(?<!\d)(?<!\d:)32,854/],
  ['3992077', /(?<!\d)(?<!\d:)3992077/],
  ['3285402', /(?<!\d)(?<!\d:)3285402/],
];
// What the notification says (the phone words it) and what the sender is called. The name is in
// the profile tables by design; the queue and the logs must not have it.
const WORDS = [/iyiyim/i, /güvendeyim/i, /i'm safe/i] as const;

let test: TestApp;
let url: string;
let logs = '';
const sockets: Socket[] = [];

beforeAll(async () => {
  // Everything the server logs, at the most verbose level, is kept and searched below.
  const logStream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logs += chunk.toString('utf8');
      done();
    },
  });
  test = await createTestApp({
    env: testEnv({ LOG_LEVEL: 'trace', BILLING_TEST: 'on', FCM_SERVICE_ACCOUNT: account }),
    logStream,
  });
  await test.app.listen(0, '127.0.0.1');
  url = await test.app.getUrl();
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await test.close();
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

function collect<T>(socket: Socket, name: string): T[] {
  const received: T[] = [];
  socket.on(name, (payload: T) => {
    received.push(payload);
  });
  return received;
}

/** A member's phone: its sender key for the circle's epoch, sequence numbers kept. */
function phone(who: Person, circle: Pick<Circle, 'id' | 'epoch'>) {
  let state: SenderState = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  const seal = (payload: Payload): MessageEnvelope => {
    const { envelope, nextState } = encryptMessage({ state, sender: who.device, payload });
    state = nextState;
    return envelope;
  };
  return {
    key: state.senderKey,
    /** "Güvendeyim" with the given id (a fresh one by default). */
    safe(id = generateMessageId(), overrides: Partial<SafePayload> = {}) {
      const payload: SafePayload = {
        kind: 'safe',
        id,
        lat: LAT,
        lng: LNG,
        acc: 9,
        bat: 45,
        ts: Date.now(),
        ...overrides,
      };
      return { id, envelope: seal(payload) };
    },
    seal,
  };
}

const sendSafe = (who: Person, body: unknown) => as(test, who, 'POST', '/v1/safe', body);

function open(envelope: MessageEnvelope, key: SenderKey, circle: Circle, from: Person) {
  const device = circle.members.find((member) => member.userId === from.userId)?.device ?? null;
  if (device === null) throw new Error('sender has no device card');
  return decryptMessage({
    envelope,
    senderKey: key,
    sender: verifyDeviceKeyBundle(device.bundle),
    replay: new ReplayGuard(),
  });
}

/** Everything the server keeps under `safe:`: the keys and their values and lifetimes. */
async function guards(): Promise<{ key: string; value: string | null; ttl: number }[]> {
  const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
  await redis.connect();
  try {
    const found: { key: string; value: string | null; ttl: number }[] = [];
    for await (const keys of redis.scanIterator({ MATCH: 'safe:*', COUNT: 500 })) {
      for (const key of keys) {
        found.push({ key, value: await redis.get(key), ttl: await redis.ttl(key) });
      }
    }
    return found;
  } finally {
    await redis.close();
  }
}

/** Sealed notifications queued for a user (what the worker will send). */
async function queuedFor(userId: string): Promise<{ deviceId: string; sealed: string }[]> {
  const { rows } = await test.admin.query<{
    data: { type: string; deviceId: string; sealed: string };
  }>(`SELECT data FROM pgboss.job WHERE name = 'push.send' AND data->>'userId' = $1`, [userId]);
  return rows.flatMap((row) =>
    row.data.type === 'sealed' ? [{ deviceId: row.data.deviceId, sealed: row.data.sealed }] : [],
  );
}

/** A notification from `from` for one member's device, sealed as the phone does. */
function pushFor(from: Person, circle: Circle, to: Person, id: string): DevicePushes {
  const device = circle.members.find((member) => member.userId === to.userId)?.device;
  if (device === undefined || device === null) throw new Error('no device');
  return [
    {
      userId: to.userId,
      deviceId: device.bundle.deviceId,
      sealed: sealPush({
        recipient: verifyDeviceKeyBundle(device.bundle),
        sender: from.device,
        body: { kind: 'safe', circleId: circle.id, id, bat: 45, ts: Date.now() },
      }),
    },
  ];
}

const simulate = (who: Person, action: string) =>
  as(test, who, 'POST', '/v1/billing/test/simulate', { action });

describe('Güvendeyim (docs/ADR/0029)', () => {
  it('reaches the members who are online at once, and the server keeps only a hash for a day', async () => {
    const [ayse, bora] = await Promise.all([person(test, NAME), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const boraSocket = await connect(bora);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'safe');
    const ayseSocket = await connect(ayse);
    const toAyse = collect<{ envelope: MessageEnvelope }>(ayseSocket, 'safe');
    const ayses = phone(ayse, circle);
    const message = ayses.safe();

    const reply = await sendSafe(ayse, message);
    expect(reply.statusCode).toBe(200);
    expect(reply.json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });
    const delivered = toBora[0];
    if (delivered === undefined) throw new Error('nothing delivered');
    // Bora's phone, holding Ayşe's sender key, reads it; nothing in between could.
    expect(open(delivered.envelope, ayses.key, circle, ayse)).toMatchObject({
      kind: 'safe',
      id: message.id,
      lat: LAT,
      lng: LNG,
      acc: 9,
      bat: 45,
    });
    expect(toAyse).toEqual([]);

    // All the server kept: one key, a hash, the value 1, a day to live. No id, user or circle in
    // it, no time, no content.
    const kept = await guards();
    expect(kept).toHaveLength(1);
    expect(kept[0]?.key).toMatch(/^safe:[0-9a-f]{32}$/);
    expect(kept[0]?.value).toBe('1');
    expect(kept[0]?.ttl).toBeGreaterThan(SAFE_GUARD_SECONDS - 60);
    expect(kept[0]?.ttl).toBeLessThanOrEqual(SAFE_GUARD_SECONDS);
    for (const secret of [message.id, ayse.userId, bora.userId, circle.id]) {
      expect(kept[0]?.key).not.toContain(secret);
    }

    // Nowhere on the server, in any form: Redis, the database (queue included), the logs.
    const dump = await dumpEverything(test);
    expect(dump).toContain(circle.id);
    expect(logs).toContain('/v1/safe');
    for (const [text, leak] of COORDINATE_LEAKS) {
      expect(dump, `dump: ${text}`).not.toMatch(leak);
      expect(logs, `logs: ${text}`).not.toMatch(leak);
    }
    for (const words of WORDS) {
      expect(dump).not.toMatch(words);
      expect(logs).not.toMatch(words);
    }
    // Nor the message's own id: the request body is never logged and the guard is a hash of it.
    expect(dump).not.toContain(message.id);
    expect(logs).not.toContain(message.id);
  });

  it('works in a paused circle and for accounts without a plan, which the live location does not', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const boraSocket = await connect(bora);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'safe');
    const ayses = phone(ayse, circle);

    // Both trials end: nobody keeps the circle open and neither has a plan.
    expect((await simulate(ayse, 'endTrial')).json<Plan>().plan).toBe('free');
    expect((await simulate(bora, 'endTrial')).json<Plan>().plan).toBe('free');
    const paused = (await as(test, ayse, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    expect(paused.paused).toBe(true);
    const live = await as(test, ayse, 'POST', '/v1/locations', {
      envelopes: [ayses.seal({ kind: 'loc', lat: 1, lng: 2, acc: 3, bat: 4, chg: false, ts: 5 })],
    });
    expect(live.json()).toMatchObject({ refused: [{ code: 'PAUSED' }] });

    const reply = await sendSafe(ayse, ayses.safe());
    expect(reply.json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });
  });

  it('works for 15-17, who may come into a circle only with a code', async () => {
    const [teen, parent] = await Promise.all([person(test, 'Deniz', '15-17'), person(test)]);
    const circle = await createCircle(test, parent);
    const invite = (
      await as(test, parent, 'POST', '/v1/invites', { kind: 'circle', circleId: circle.id })
    ).json<Invite>();
    expect(
      (await as(test, teen, 'POST', '/v1/invites/accept', { token: invite.token })).statusCode,
    ).toBe(200);
    const joined = (await as(test, parent, 'GET', `/v1/circles/${circle.id}`)).json<Circle>();
    const parentSocket = await connect(parent);
    const toParent = collect<{ envelope: MessageEnvelope }>(parentSocket, 'safe');

    const reply = await sendSafe(teen, phone(teen, joined).safe());
    expect(reply.json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toParent).toHaveLength(1);
    });
  });

  it('refuses a stranger, a non-member, a forged or outdated message, and remembers nothing of them', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const boraSocket = await connect(bora);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'safe');
    const before = (await guards()).length;
    const queuedBefore = (await queuedFor(bora.userId)).length;

    // Someone outside the circle, with a good envelope of their own and a push for Bora.
    const strangers = phone(mallory, circle).safe();
    const outsider = await sendSafe(mallory, {
      ...strangers,
      pushes: pushFor(mallory, circle, bora, strangers.id),
    });
    expect(outsider.json()).toEqual({ refused: 'NOT_MEMBER' });
    // Signed by another device than the one asking.
    const forged = phone(ayse, circle).safe();
    expect((await sendSafe(mallory, forged)).json()).toEqual({ refused: 'INVALID' });
    // A future epoch.
    const future = phone(ayse, { ...circle, epoch: circle.epoch + 1 }).safe();
    expect((await sendSafe(ayse, future)).json()).toEqual({ refused: 'EPOCH' });
    // A circle that does not exist.
    const nowhere = phone(ayse, { id: '0190f7a4-5b6c-7d8e-9f01-23456789abcd', epoch: 1 }).safe();
    expect((await sendSafe(ayse, nowhere)).json()).toEqual({ refused: 'NOT_MEMBER' });

    // Nothing was told, queued or remembered.
    expect(toBora).toEqual([]);
    expect(await queuedFor(bora.userId)).toHaveLength(queuedBefore);
    expect(await guards()).toHaveLength(before);

    // Malformed asks never get as far: no id, a short id, an extra field, no envelope.
    const good = phone(ayse, circle).safe();
    for (const body of [
      { envelope: good.envelope },
      { ...good, id: 'short' },
      { ...good, id: `${'A'.repeat(21)}B` },
      { ...good, extra: true },
      { id: good.id },
      {},
    ]) {
      expect((await sendSafe(ayse, body)).statusCode).toBe(400);
    }
    // Unsigned, or without a session, it does not get in either.
    const unsigned = await call(test.app, {
      url: '/v1/safe',
      accessToken: ayse.session.accessToken,
      body: good,
    });
    expect(unsigned.statusCode).toBe(401);
    const anonymous = await call(test.app, { url: '/v1/safe', body: good });
    expect(anonymous.statusCode).toBe(401);
    // A member who was removed is a non-member from then on.
    const removed = await circleWith(test, ayse, bora);
    await as(test, ayse, 'POST', `/v1/circles/${removed.id}/members/${bora.userId}/remove`);
    expect((await sendSafe(bora, phone(bora, removed).safe())).json()).toEqual({
      refused: 'NOT_MEMBER',
    });
    expect(await guards()).toHaveLength(before);
  });

  it('is done once however often it is asked: the same id is answered ok and sent no more', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayses = phone(ayse, circle);
    const boraSocket = await connect(bora);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'safe');
    const message = ayses.safe();

    expect((await sendSafe(ayse, message)).json()).toEqual({ ok: true });
    // The phone did not hear the answer and asks again, with a new envelope of the same message.
    const again = ayses.safe(message.id);
    expect((await sendSafe(ayse, again)).json()).toEqual({ ok: true });
    expect((await sendSafe(ayse, message)).json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });

    // A message of its own is another matter, and so is the same id from another sender or in
    // another circle (the guard is of the message, not of the id alone).
    expect((await sendSafe(ayse, ayses.safe())).json()).toEqual({ ok: true });
    const other = await circleWith(test, ayse, bora);
    const inOther = phone(ayse, other).safe(message.id);
    expect((await sendSafe(ayse, inOther)).json()).toEqual({ ok: true });
    const boras = phone(bora, circle).safe(message.id);
    expect((await sendSafe(bora, boras)).json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(3);
    });
    // Nobody is told of their own message.
    const toAyse = collect<{ envelope: MessageEnvelope }>(await connect(ayse), 'safe');
    expect((await sendSafe(ayse, ayses.safe())).json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(4);
    });
    expect(toAyse).toEqual([]);
  });

  it('forgets a message after a day: its hash expires, and then the same id is a new message', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayses = phone(ayse, circle);
    const toBora = collect<{ envelope: MessageEnvelope }>(await connect(bora), 'safe');
    const message = ayses.safe();
    const known = new Set((await guards()).map((guard) => guard.key));
    expect((await sendSafe(ayse, message)).json()).toEqual({ ok: true });
    const mine = (await guards()).filter((guard) => !known.has(guard.key));
    expect(mine).toHaveLength(1);
    const key = mine[0]?.key ?? '';
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });

    // A day goes by (Redis is told it is time: the lifetime is the only thing that removes it).
    const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
    await redis.connect();
    try {
      expect(await redis.pExpire(key, 50)).toBe(1);
      await vi.waitFor(async () => {
        expect(await redis.exists(key)).toBe(0);
      });
    } finally {
      await redis.close();
    }
    expect((await sendSafe(ayse, ayses.safe(message.id))).json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(2);
    });
  });

  it('allows six an hour per sender and circle, counts no repeat, and remembers no refused one', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const other = await circleWith(test, ayse, bora);
    const ayses = phone(ayse, circle);
    const toBora = collect<{ envelope: MessageEnvelope }>(await connect(bora), 'safe');
    const first = ayses.safe();

    const replies: unknown[] = [];
    for (let sent = 0; sent < 6; sent += 1) {
      replies.push((await sendSafe(ayse, sent === 0 ? first : ayses.safe())).json());
    }
    expect(replies).toEqual(Array.from({ length: 6 }, () => ({ ok: true })));
    // The seventh is refused, and the server keeps nothing of it, so asking later can still work.
    const known = (await guards()).length;
    const seventh = ayses.safe();
    expect((await sendSafe(ayse, seventh)).json()).toEqual({ refused: 'RATE_LIMITED' });
    expect(await guards()).toHaveLength(known);
    // A repeat of one already done is answered ok even now: it is not a new message.
    expect((await sendSafe(ayse, first)).json()).toEqual({ ok: true });
    // Another circle has its own allowance, and Bora his.
    expect((await sendSafe(ayse, phone(ayse, other).safe())).json()).toEqual({ ok: true });
    expect((await sendSafe(bora, phone(bora, circle).safe())).json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(7);
    });
  });

  it('sends the sealed notifications to the members who are offline only, once per device, and nowhere else', async () => {
    const [ayse, bora, can, mallory] = await Promise.all([
      person(test, NAME),
      person(test),
      person(test),
      person(test),
    ]);
    const circle = await circleWith(test, ayse, bora, can);
    // Can has the app open; Bora does not.
    const toCan = collect<{ envelope: MessageEnvelope }>(await connect(can), 'safe');
    const ayses = phone(ayse, circle);
    const message = ayses.safe();
    const toBora = pushFor(ayse, circle, bora, message.id);
    const pushes: DevicePushes = [
      ...toBora,
      ...pushFor(ayse, circle, can, message.id),
      // Not a member: the server drops it instead of waking a stranger's phone.
      {
        userId: mallory.userId,
        deviceId: mallory.device.deviceId,
        sealed: toBora[0]?.sealed ?? '',
      },
      // Ayşe herself is not among the others.
      { userId: ayse.userId, deviceId: ayse.device.deviceId, sealed: toBora[0]?.sealed ?? '' },
      // The same one again: once per device.
      ...toBora,
    ];

    expect((await sendSafe(ayse, { ...message, pushes })).json()).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toCan).toHaveLength(1);
    });
    const boraBox = await queuedFor(bora.userId);
    expect(boraBox).toEqual([{ deviceId: toBora[0]?.deviceId, sealed: toBora[0]?.sealed }]);
    expect(await queuedFor(can.userId)).toEqual([]);
    expect(await queuedFor(mallory.userId)).toEqual([]);
    expect(await queuedFor(ayse.userId)).toEqual([]);

    // The queue holds a box only Bora's phone opens: no name, no words, no battery, no kind, no id.
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT data::text AS dump FROM pgboss.job
        WHERE name = 'push.send' AND data->>'type' = 'sealed' AND data->>'userId' = $1`,
      [bora.userId],
    );
    expect(rows).toHaveLength(1);
    for (const row of rows) {
      // Four fields and nothing else: the box is the only thing about the message in the job.
      expect(Object.keys(JSON.parse(row.dump) as object).sort()).toEqual([
        'deviceId',
        'sealed',
        'type',
        'userId',
      ]);
      for (const words of WORDS) expect(row.dump).not.toMatch(words);
      expect(row.dump).not.toMatch(new RegExp(NAME, 'i'));
      for (const [text, leak] of COORDINATE_LEAKS) expect(row.dump, text).not.toMatch(leak);
      expect(row.dump).not.toContain(message.id);
    }
    // Opened with Bora's keys, the box is what Ayşe's phone made, signed by her device.
    expect(boraBox[0]?.sealed).toBe(toBora[0]?.sealed);
    const trusted = (deviceId: string) =>
      deviceId === ayse.device.deviceId ? ayse.device.identity.publicKey : null;
    const opened = openPush({
      recipient: bora.device,
      sealed: boraBox[0]?.sealed ?? '',
      senderIdentityKey: trusted,
    });
    expect(opened.body).toMatchObject({
      kind: 'safe',
      circleId: circle.id,
      id: message.id,
      bat: 45,
    });
    // And Can's phone cannot open Bora's box.
    expect(() =>
      openPush({
        recipient: can.device,
        sealed: boraBox[0]?.sealed ?? '',
        senderIdentityKey: trusted,
      }),
    ).toThrow();
  });

  it('lets a message go when it could not be delivered, so asking again still works', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const message = phone(ayse, circle).safe();
    const pushes = pushFor(ayse, circle, bora, message.id);
    const known = new Set((await guards()).map((guard) => guard.key));
    const forward = vi
      .spyOn(test.app.get(Notifier), 'forward')
      .mockRejectedValueOnce(new Error('the queue is down'));

    const failed = await sendSafe(ayse, { ...message, pushes });
    expect(failed.statusCode).toBe(500);
    expect((await guards()).filter((guard) => !known.has(guard.key))).toEqual([]);
    forward.mockRestore();

    expect((await sendSafe(ayse, { ...message, pushes })).json()).toEqual({ ok: true });
    expect((await guards()).filter((guard) => !known.has(guard.key))).toHaveLength(1);
    expect(await queuedFor(bora.userId)).toHaveLength(1);
  });
});
