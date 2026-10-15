import { Writable } from 'node:stream';

import {
  createSenderState,
  decryptMessage,
  encryptHistory,
  encryptMessage,
  generateRequestNonce,
  generateSenderKey,
  ReplayGuard,
  type SenderKey,
  type SenderState,
  signRequest,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  HISTORY_SLOT_MS,
  historySlot,
  type MessageEnvelope,
  type Payload,
  type PublishReply,
  publishReplySchema,
} from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

// Somewhere in Istanbul: the test proves these numbers never reach the server in any form.
const LAT = 41.008_237;
const LNG = 28.978_359;
const COORDINATE_TEXTS = ['41.008', '28.978', '41,008', '28,978', '4100824', '2897836'];

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
  test = await createTestApp({ env: testEnv({ LOG_LEVEL: 'trace' }), logStream });
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

/** A sender as the app is: its own sender key for the circle's epoch, sequence numbers kept. */
function sender(who: Person, circle: Circle) {
  let state: SenderState = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  return {
    key: state.senderKey,
    next(lat = LAT, lng = LNG): MessageEnvelope {
      const { envelope, nextState } = encryptMessage({
        state,
        sender: who.device,
        payload: { kind: 'loc', lat, lng, acc: 8, bat: 64, chg: false, ts: Date.now() },
      });
      state = nextState;
      return envelope;
    },
    /** Any other message (a poke, a status) with the same key and sequence. */
    message(payload: Payload): MessageEnvelope {
      const { envelope, nextState } = encryptMessage({ state, sender: who.device, payload });
      state = nextState;
      return envelope;
    },
  };
}

async function publishWs(socket: Socket, envelopes: MessageEnvelope[]): Promise<PublishReply> {
  return publishReplySchema.parse(await socket.emitWithAck('publish', { envelopes }));
}

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

describe('location relay', () => {
  it('delivers a location to the other members at once, and only ciphertext ever reaches it', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const [ayseSocket, boraSocket] = await Promise.all([connect(ayse), connect(bora)]);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'loc');
    const toAyse = collect<{ envelope: MessageEnvelope }>(ayseSocket, 'loc');
    const ayseSends = sender(ayse, circle);

    const reply = await publishWs(ayseSocket, [ayseSends.next()]);
    expect(reply).toEqual({ accepted: 1, refused: [] });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });
    expect(toAyse).toEqual([]);
    // Bora's phone, holding Ayşe's sender key, reads it; nothing in between could.
    const delivered = toBora[0];
    if (delivered === undefined) throw new Error('nothing delivered');
    const payload = open(delivered.envelope, ayseSends.key, circle, ayse);
    expect(payload).toMatchObject({ kind: 'loc', lat: LAT, lng: LNG });

    // Over HTTP too (the app in the background), and the snapshot has the newest one.
    const viaHttp = ayseSends.next(LAT + 0.001, LNG);
    const httpReply = await as(test, ayse, 'POST', '/v1/locations', { envelopes: [viaHttp] });
    expect(httpReply.json()).toEqual({ accepted: 1, refused: [] });
    const snapshot = await as(test, bora, 'GET', '/v1/locations');
    expect(snapshot.json<{ envelopes: MessageEnvelope[] }>().envelopes).toEqual([viaHttp]);
    // Ayşe's own location is not echoed back to her.
    expect((await as(test, ayse, 'GET', '/v1/locations')).json()).toEqual({ envelopes: [] });

    // A quarter hour of her trail as well (location history, docs/ADR/0019), in its own form.
    const slot = historySlot(Date.now()) - HISTORY_SLOT_MS;
    const trail = encryptHistory({
      state: { senderKey: ayseSends.key, nextSeq: 1_000 },
      sender: ayse.device,
      payload: {
        kind: 'trail',
        from: slot,
        points: [[0, Math.round(LAT * 100_000), Math.round(LNG * 100_000), 9]],
        ts: Date.now(),
      },
    }).envelope;
    const piece = await as(test, ayse, 'PUT', `/v1/circles/${circle.id}/history/${String(slot)}`, {
      envelope: trail,
    });
    expect(piece.statusCode).toBe(204);

    // DoD (Faz 5, ADR 0019): no plain coordinate anywhere on the server: Redis, the database, the
    // logs, in either form.
    const redisDump: string[] = [];
    const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
    await redis.connect();
    try {
      for await (const keys of redis.scanIterator({ COUNT: 500 })) {
        for (const key of keys) {
          const type = await redis.type(key);
          if (type === 'string') redisDump.push(String(await redis.get(key)));
          if (type === 'hash') redisDump.push(JSON.stringify(await redis.hGetAll(key)));
          if (type === 'stream') redisDump.push(JSON.stringify(await redis.xRange(key, '-', '+')));
          if (type === 'list') redisDump.push(JSON.stringify(await redis.lRange(key, 0, -1)));
          if (type === 'set') redisDump.push(JSON.stringify(await redis.sMembers(key)));
          if (type === 'zset') redisDump.push(JSON.stringify(await redis.zRange(key, 0, -1)));
        }
      }
    } finally {
      await redis.close();
    }
    const { rows: tables } = await test.admin.query<{ name: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS name FROM pg_tables
        WHERE schemaname IN ('app', 'pgboss')`,
    );
    const databaseDump: string[] = [];
    for (const { name } of tables) {
      const { rows } = await test.admin.query<{ dump: string | null }>(
        `SELECT json_agg(t)::text AS dump FROM ${name} t`,
      );
      databaseDump.push(rows[0]?.dump ?? '');
    }
    expect(redisDump.join('\n')).toContain(circle.id);
    expect(logs).toContain('/v1/locations');
    for (const text of COORDINATE_TEXTS) {
      expect(redisDump.join('\n'), `redis: ${text}`).not.toContain(text);
      expect(databaseDump.join('\n'), `database: ${text}`).not.toContain(text);
      expect(logs, `logs: ${text}`).not.toContain(text);
    }
  });

  it('keeps the newest location when an older one arrives late', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayseSends = sender(ayse, circle);
    const older = ayseSends.next();
    const newer = ayseSends.next();
    await as(test, ayse, 'POST', '/v1/locations', { envelopes: [newer] });
    await as(test, ayse, 'POST', '/v1/locations', { envelopes: [older] });
    const snapshot = (await as(test, bora, 'GET', '/v1/locations')).json<{
      envelopes: MessageEnvelope[];
    }>();
    expect(snapshot.envelopes).toEqual([newer]);
  });

  it('refuses forged, foreign, outdated and too frequent envelopes', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayseSocket = await connect(ayse);
    const ayseSends = sender(ayse, circle);

    // Signed by another device than the one publishing.
    const forged = sender(mallory, circle).next();
    expect((await publishWs(ayseSocket, [forged])).refused).toEqual([
      { circleId: circle.id, code: 'INVALID' },
    ]);
    // Someone outside the circle.
    const malloryHttp = await as(test, mallory, 'POST', '/v1/locations', {
      envelopes: [sender(mallory, circle).next()],
    });
    expect(malloryHttp.json<PublishReply>().refused).toEqual([
      { circleId: circle.id, code: 'NOT_MEMBER' },
    ]);
    // A future epoch.
    const future = sender(ayse, { ...circle, epoch: circle.epoch + 1 }).next();
    expect((await publishWs(ayseSocket, [future])).refused[0]?.code).toBe('EPOCH');
    // More than live mode needs: the rest is dropped.
    const codes: string[] = [];
    for (let i = 0; i < 6; i++) {
      const reply = await publishWs(ayseSocket, [ayseSends.next()]);
      codes.push(reply.refused[0]?.code ?? 'ok');
    }
    expect(codes).toContain('RATE_LIMITED');
    expect(codes.slice(0, 3)).toEqual(['ok', 'ok', 'ok']);
    // Malformed input is refused before anything else.
    expect(await ayseSocket.emitWithAck('publish', { envelopes: [] })).toEqual({
      error: 'VALIDATION_FAILED',
    });
  });

  it('takes a member’s dot away when they are removed, leave or withdraw', async () => {
    const [ayse, bora, can] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora, can);
    const boraSocket = await connect(bora);
    const gone = collect<{ circleId: string; userId: string }>(boraSocket, 'loc.gone');
    await as(test, can, 'POST', '/v1/locations', { envelopes: [sender(can, circle).next()] });
    await as(test, ayse, 'POST', '/v1/locations', { envelopes: [sender(ayse, circle).next()] });
    expect(
      (await as(test, bora, 'GET', '/v1/locations')).json<{ envelopes: MessageEnvelope[] }>()
        .envelopes,
    ).toHaveLength(2);

    await as(test, ayse, 'POST', `/v1/circles/${circle.id}/members/${can.userId}/remove`);
    await vi.waitFor(() => {
      expect(gone).toContainEqual({ circleId: circle.id, userId: can.userId });
    });
    // Ayşe hides: her last location goes as well.
    expect(
      (await as(test, ayse, 'POST', '/v1/locations/withdraw', { circleIds: [circle.id] }))
        .statusCode,
    ).toBe(204);
    await vi.waitFor(() => {
      expect(gone).toContainEqual({ circleId: circle.id, userId: ayse.userId });
    });
    expect((await as(test, bora, 'GET', '/v1/locations')).json()).toEqual({ envelopes: [] });
    // The removed member can no longer read anything of the circle.
    expect((await as(test, can, 'GET', '/v1/locations')).json()).toEqual({ envelopes: [] });
  });

  it('asks the other members for live updates when someone looks at the circle', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const [ayseSocket, boraSocket, mallorySocket] = await Promise.all([
      connect(ayse),
      connect(bora),
      connect(mallory),
    ]);
    const toBora = collect<{ circleId: string }>(boraSocket, 'watch');
    expect(await ayseSocket.emitWithAck('watch', { circleId: circle.id })).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toEqual([{ circleId: circle.id }]);
    });
    expect(await mallorySocket.emitWithAck('watch', { circleId: circle.id })).toEqual({
      error: 'NOT_FOUND',
    });
    // At most twice in 30 seconds per circle (the app renews once a minute).
    await ayseSocket.emitWithAck('watch', { circleId: circle.id });
    expect(await ayseSocket.emitWithAck('watch', { circleId: circle.id })).toEqual({
      error: 'RATE_LIMITED',
    });
  });
});

describe('pokes and statuses', () => {
  it('pokes the other members at once and keeps nothing of it', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const [ayseSocket, boraSocket] = await Promise.all([connect(ayse), connect(bora)]);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'bump');
    const ayseSends = sender(ayse, circle);

    const poke = ayseSends.message({ kind: 'bump', ts: Date.now() });
    expect(await ayseSocket.emitWithAck('bump', { envelope: poke })).toEqual({ ok: true });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });
    const delivered = toBora[0];
    if (delivered === undefined) throw new Error('nothing delivered');
    expect(open(delivered.envelope, ayseSends.key, circle, ayse)).toMatchObject({ kind: 'bump' });

    // Over HTTP too; and nothing about pokes is stored (only the rate limit counter exists).
    const viaHttp = await as(test, ayse, 'POST', '/v1/bumps', {
      envelope: ayseSends.message({ kind: 'bump', ts: Date.now() }),
    });
    expect(viaHttp.json()).toEqual({ ok: true });
    const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
    await redis.connect();
    try {
      for await (const keys of redis.scanIterator({ MATCH: `*${circle.id}*`, COUNT: 500 })) {
        for (const key of keys) expect(key.startsWith('rl:') || key.startsWith('loc:')).toBe(true);
      }
    } finally {
      await redis.close();
    }

    // Someone outside the circle cannot poke into it.
    const outsider = await as(test, mallory, 'POST', '/v1/bumps', {
      envelope: sender(mallory, circle).message({ kind: 'bump', ts: Date.now() }),
    });
    expect(outsider.json()).toEqual({ refused: 'NOT_MEMBER' });
    // At most ten a minute per circle: the rest is refused.
    const replies: unknown[] = [];
    for (let i = 0; i < 10; i++) {
      replies.push(
        await ayseSocket.emitWithAck('bump', {
          envelope: ayseSends.message({ kind: 'bump', ts: Date.now() }),
        }),
      );
    }
    expect(replies).toContainEqual({ refused: 'RATE_LIMITED' });
  });

  it('keeps a status for the time chosen, and drops it when withdrawn', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const boraSocket = await connect(bora);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'status');
    const gone = collect<{ circleId: string; userId: string }>(boraSocket, 'status.gone');
    const ayseSends = sender(ayse, circle);
    const status = ayseSends.message({
      kind: 'status',
      emoji: '☕',
      text: 'kahve molası',
      expiresAt: Date.now() + 3_600_000,
      ts: Date.now(),
    });

    const reply = await as(test, ayse, 'POST', '/v1/statuses', {
      envelopes: [status],
      ttlSeconds: 3_600,
    });
    expect(reply.json()).toEqual({ accepted: 1, refused: [] });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });
    const snapshot = await as(test, bora, 'GET', '/v1/statuses');
    expect(snapshot.json()).toEqual({ envelopes: [status] });
    // The location snapshot is separate and stays empty.
    expect((await as(test, bora, 'GET', '/v1/locations')).json()).toEqual({ envelopes: [] });
    // Its field lives for the chosen time, not the 24 hours of a location.
    const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
    await redis.connect();
    try {
      const ttl = (await redis.hTTL(`status:${circle.id}`, ayse.userId))?.[0];
      expect(ttl).toBeGreaterThan(3_500);
      expect(ttl).toBeLessThanOrEqual(3_600);
    } finally {
      await redis.close();
    }
    // Longer than a day is refused before anything is stored.
    const tooLong = await as(test, ayse, 'POST', '/v1/statuses', {
      envelopes: [status],
      ttlSeconds: 2 * 24 * 3_600,
    });
    expect(tooLong.statusCode).toBe(400);

    expect(
      (await as(test, ayse, 'POST', '/v1/statuses/withdraw', { circleIds: [circle.id] }))
        .statusCode,
    ).toBe(204);
    await vi.waitFor(() => {
      expect(gone).toContainEqual({ circleId: circle.id, userId: ayse.userId });
    });
    expect((await as(test, bora, 'GET', '/v1/statuses')).json()).toEqual({ envelopes: [] });
  });
});
