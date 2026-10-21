import { Writable } from 'node:stream';

import {
  createSenderState,
  decryptMessage,
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
  type MessageEnvelope,
  type Payload,
  type PublishReply,
  publishReplySchema,
  type Plan,
} from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { STATE_TTL_SECONDS } from '../../src/relay/relay.service.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
import { call } from './support/client.js';
import { as, circleWith, type Person, person } from './support/people.js';

// "Neden eski?" (docs/ADR/0028): why a member's last location may be old, on a route of its own.

let test: TestApp;
let url: string;
let logs = '';
const sockets: Socket[] = [];

beforeAll(async () => {
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

/** A member's phone: its own sender key for the circle's epoch, sequence numbers kept. */
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
    seal,
    /** A `state` message (battery saver unless said otherwise). */
    state(why: 'saver' | 'permission' | 'nofix' | 'none' = 'saver'): MessageEnvelope {
      const now = Date.now();
      return seal({ kind: 'state', why, since: now, ts: now });
    },
    loc(): MessageEnvelope {
      return seal({ kind: 'loc', lat: 41, lng: 29, acc: 8, bat: 60, chg: false, ts: Date.now() });
    },
  };
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

const sendState = async (socket: Socket, envelopes: MessageEnvelope[]): Promise<PublishReply> =>
  publishReplySchema.parse(await socket.emitWithAck('state', { envelopes }));

const snapshot = async (who: Person): Promise<MessageEnvelope[]> =>
  (await as(test, who, 'GET', '/v1/states')).json<{ envelopes: MessageEnvelope[] }>().envelopes;

describe('state messages (docs/ADR/0028)', () => {
  it('reach the circle-mates at once as a state event, keep only the newest, and read back as a snapshot', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const [ayseSocket, boraSocket] = await Promise.all([connect(ayse), connect(bora)]);
    const toBora = collect<{ envelope: MessageEnvelope }>(boraSocket, 'state');
    const toAyse = collect<{ envelope: MessageEnvelope }>(ayseSocket, 'state');
    // A state is not a location: no `loc` event rides with it.
    const locs = collect<unknown>(boraSocket, 'loc');
    const ayses = phone(ayse, circle);

    const first = ayses.state('saver');
    expect(await sendState(ayseSocket, [first])).toEqual({ accepted: 1, refused: [] });
    await vi.waitFor(() => {
      expect(toBora).toHaveLength(1);
    });
    expect(toAyse).toEqual([]);
    expect(locs).toEqual([]);
    const delivered = toBora[0];
    if (delivered === undefined) throw new Error('nothing delivered');
    expect(open(delivered.envelope, ayses.key, circle, ayse)).toMatchObject({
      kind: 'state',
      why: 'saver',
    });

    // Over HTTP too, and the snapshot has the newest one only; her own is not echoed to her.
    const second = ayses.state('nofix');
    const viaHttp = await as(test, ayse, 'POST', '/v1/states', { envelopes: [second] });
    expect(viaHttp.json()).toEqual({ accepted: 1, refused: [] });
    expect(await snapshot(bora)).toEqual([second]);
    expect(await snapshot(ayse)).toEqual([]);
    // One that arrives late (an older number) does not replace it, and nobody is told again.
    await as(test, ayse, 'POST', '/v1/states', { envelopes: [first] });
    expect(await snapshot(bora)).toEqual([second]);
    // Someone outside every circle gets nothing, in either form.
    expect(await snapshot(mallory)).toEqual([]);
    const mallorySocket = await connect(mallory);
    expect(await mallorySocket.emitWithAck('states')).toEqual({ envelopes: [] });
    expect(await boraSocket.emitWithAck('states')).toEqual({ envelopes: [second] });
  });

  it('is its own slot: it never takes the place of the location', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayses = phone(ayse, circle);
    const location = ayses.loc();
    await as(test, ayse, 'POST', '/v1/locations', { envelopes: [location] });
    await as(test, ayse, 'POST', '/v1/states', { envelopes: [ayses.state()] });
    const locations = (await as(test, bora, 'GET', '/v1/locations')).json<{
      envelopes: MessageEnvelope[];
    }>();
    expect(locations.envelopes).toEqual([location]);
    expect(await snapshot(bora)).toHaveLength(1);
  });

  it('refuses forged, foreign, outdated and too frequent envelopes, and bad input', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayseSocket = await connect(ayse);
    const ayses = phone(ayse, circle);

    // Signed by another device than the one publishing: Bora cannot speak for Ayşe.
    const asAyse = await as(test, bora, 'POST', '/v1/states', { envelopes: [ayses.state()] });
    expect(asAyse.json<PublishReply>().refused).toEqual([{ circleId: circle.id, code: 'INVALID' }]);
    // Someone outside the circle.
    const outsider = await as(test, mallory, 'POST', '/v1/states', {
      envelopes: [phone(mallory, circle).state()],
    });
    expect(outsider.json<PublishReply>().refused).toEqual([
      { circleId: circle.id, code: 'NOT_MEMBER' },
    ]);
    expect(await snapshot(bora)).toEqual([]);
    // A future epoch.
    const future = phone(ayse, { ...circle, epoch: circle.epoch + 1 }).state();
    expect((await sendState(ayseSocket, [future])).refused[0]?.code).toBe('EPOCH');
    // More than the phone's own once-per-45-seconds rule needs: three in a minute, then no more.
    const codes: string[] = [];
    for (let i = 0; i < 5; i++) {
      codes.push((await sendState(ayseSocket, [ayses.state()])).refused[0]?.code ?? 'ok');
    }
    expect(codes).toEqual(['ok', 'ok', 'ok', 'RATE_LIMITED', 'RATE_LIMITED']);
    // One circle's allowance is not another's.
    const other = await circleWith(test, ayse, await person(test));
    expect(await sendState(ayseSocket, [phone(ayse, other).state()])).toEqual({
      accepted: 1,
      refused: [],
    });

    // Malformed input is refused before anything else, on both routes.
    expect(await ayseSocket.emitWithAck('state', { envelopes: [] })).toEqual({
      error: 'VALIDATION_FAILED',
    });
    expect(await ayseSocket.emitWithAck('state', { envelopes: [ayses.state()], extra: 1 })).toEqual(
      { error: 'VALIDATION_FAILED' },
    );
    for (const body of [{ envelopes: [] }, { envelopes: [{ nonsense: true }] }, {}, 'text']) {
      const bad = await as(test, ayse, 'POST', '/v1/states', body);
      expect(bad.statusCode, JSON.stringify(body)).toBe(400);
    }
    // Signed in is required.
    expect((await call(test.app, { method: 'GET', url: '/v1/states' })).statusCode).toBe(401);
    expect(
      (
        await call(test.app, {
          method: 'POST',
          url: '/v1/states',
          body: { envelopes: [ayses.state()] },
        })
      ).statusCode,
    ).toBe(401);
  });

  it('is refused for a paused circle, like the live location it explains', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayses = phone(ayse, circle);
    const simulate = (who: Person) =>
      as(test, who, 'POST', '/v1/billing/test/simulate', { action: 'endTrial' });
    expect((await simulate(ayse)).json<Plan>().plan).toBe('free');
    expect((await simulate(bora)).json<Plan>().plan).toBe('free');
    expect((await as(test, ayse, 'GET', `/v1/circles/${circle.id}`)).json<Circle>().paused).toBe(
      true,
    );

    const reply = await as(test, ayse, 'POST', '/v1/states', { envelopes: [ayses.state()] });
    expect(reply.json<PublishReply>().refused).toEqual([{ circleId: circle.id, code: 'PAUSED' }]);
    expect(await snapshot(bora)).toEqual([]);
  });

  it('goes with the location when it is taken back, and with the member when they leave or are removed', async () => {
    const [ayse, bora, can, dilek] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    const circle = await circleWith(test, ayse, bora, can, dilek);
    const boraSocket = await connect(bora);
    const gone = collect<{ circleId: string; userId: string }>(boraSocket, 'state.gone');
    const [ayses, cans, dileks] = [phone(ayse, circle), phone(can, circle), phone(dilek, circle)];
    for (const [member, sends] of [
      [ayse, ayses],
      [can, cans],
      [dilek, dileks],
    ] as const) {
      await as(test, member, 'POST', '/v1/states', { envelopes: [sends.state()] });
    }
    expect(await snapshot(bora)).toHaveLength(3);

    // Removed: their reason goes, and Bora's phone is told.
    await as(test, ayse, 'POST', `/v1/circles/${circle.id}/members/${can.userId}/remove`);
    await vi.waitFor(() => {
      expect(gone).toContainEqual({ circleId: circle.id, userId: can.userId });
    });
    // Left: the same.
    await as(test, dilek, 'POST', `/v1/circles/${circle.id}/leave`);
    await vi.waitFor(() => {
      expect(gone).toContainEqual({ circleId: circle.id, userId: dilek.userId });
    });
    expect(await snapshot(bora)).toHaveLength(1);
    // The removed member can no longer read anything of the circle, or write into it.
    expect(await snapshot(can)).toEqual([]);
    const afterwards = await as(test, can, 'POST', '/v1/states', {
      envelopes: [cans.state()],
    });
    expect(afterwards.json<PublishReply>().refused[0]?.code).toBe('NOT_MEMBER');

    // Ayşe stops sharing her location with the circle: the reason for it goes, so a phone that
    // connects afterwards is not told why a location it no longer has was old.
    await as(test, ayse, 'POST', '/v1/locations', { envelopes: [ayses.loc()] });
    expect(await snapshot(bora)).toHaveLength(1);
    expect(
      (await as(test, ayse, 'POST', '/v1/locations/withdraw', { circleIds: [circle.id] }))
        .statusCode,
    ).toBe(204);
    expect(await snapshot(bora)).toEqual([]);
  });

  it('keeps ciphertext and a lifetime, nothing readable of the reason', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayses = phone(ayse, circle);
    const sealed = ayses.state('permission');
    await as(test, ayse, 'POST', '/v1/states', { envelopes: [sealed] });

    const redis = (await import('redis')).createClient({ url: test.env.REDIS_URL });
    await redis.connect();
    try {
      const key = `state:${circle.id}`;
      const fields = await redis.hGetAll(key);
      expect(Object.keys(fields)).toEqual([ayse.userId]);
      const stored = JSON.parse(fields[ayse.userId] ?? '{}') as { ct?: string };
      expect(typeof stored.ct).toBe('string');
      // The field lives as long as the location it explains, and no longer.
      const ttl = await redis.sendCommand<number[]>(['HTTL', key, 'FIELDS', '1', ayse.userId]);
      expect(ttl[0]).toBeGreaterThan(0);
      expect(ttl[0]).toBeLessThanOrEqual(STATE_TTL_SECONDS);
      expect(JSON.stringify(fields)).not.toMatch(/permission|saver|nofix/);
    } finally {
      await redis.close();
    }
    expect(logs).toContain('/v1/states');
    // The request body is never logged.
    expect(logs).not.toContain(sealed.ct);
  });
});
