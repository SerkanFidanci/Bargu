import { generateRequestNonce, signRequest, type DeviceKeys } from '@bargu/crypto';
import { type Circle, type DeliveredEvent, resumeReplySchema } from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call, login } from './support/client.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  test = await createTestApp();
  await test.app.listen(0, '127.0.0.1');
  url = await test.app.getUrl();
});
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await test.close();
});

function handshake(accessToken: string, device: DeviceKeys, nonce = generateRequestNonce()) {
  const ts = String(Date.now());
  return {
    token: accessToken,
    ts,
    nonce,
    sig: signRequest(device.identity.secretKey, {
      method: 'GET',
      path: EVENTS_PATH,
      timestamp: Number(ts),
      nonce,
      deviceId: device.deviceId,
      body: new Uint8Array(0),
    }),
  };
}

/** Connects like the app; resolves once connected, rejects with the server's refusal code. */
function connect(auth: Record<string, string>): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      path: EVENTS_PATH,
      transports: ['websocket'],
      auth,
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    socket.once('connect', () => {
      resolve(socket);
    });
    socket.once('connect_error', (error) => {
      reject(error);
    });
  });
}

const connectAs = (who: Person) => connect(handshake(who.session.accessToken, who.device));

function collect(socket: Socket): DeliveredEvent[] {
  const received: DeliveredEvent[] = [];
  socket.on('event', (event: DeliveredEvent) => {
    received.push(event);
  });
  return received;
}

describe('event socket', () => {
  it('pushes a change to the people it concerns, at once (no polling)', async () => {
    const [ali, veli] = await Promise.all([person(test), person(test)]);
    const socket = await connectAs(veli);
    const received = collect(socket);
    const pair = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    await vi.waitFor(() => {
      expect(received.map((e) => e.event)).toContainEqual({
        type: 'circle.changed',
        circleId: pair.id,
        epoch: pair.epoch,
      });
    });
  });

  it('refuses a handshake without a valid, fresh device signature', async () => {
    const [ali, mallory] = await Promise.all([person(test), person(test)]);
    await expect(connect({ token: ali.session.accessToken })).rejects.toThrow('UNAUTHENTICATED');
    // Signed by another device than the token's.
    await expect(connect(handshake(ali.session.accessToken, mallory.device))).rejects.toThrow(
      'SIGNATURE_INVALID',
    );
    await expect(connect(handshake('not-a-token', ali.device))).rejects.toThrow();
    // A captured handshake cannot be replayed (single-use nonce).
    const captured = handshake(ali.session.accessToken, ali.device);
    const first = await connect(captured);
    first.disconnect();
    await expect(connect(captured)).rejects.toThrow('SIGNATURE_INVALID');
  });

  it('replays what a phone missed while offline, in order, and asks for a reload when unsure', async () => {
    const [ali, veli, can] = await Promise.all([person(test), person(test), person(test)]);
    const first = await connectAs(veli);
    const received = collect(first);
    const pair = (
      await as(test, ali, 'POST', '/v1/friends', { username: veli.username })
    ).json<Circle>();
    await vi.waitFor(() => {
      expect(received).toHaveLength(1);
    });
    const lastSeen = received[0]?.id ?? null;
    first.disconnect();

    // While Veli is offline: Can's request arrives, and Veli accepts Ali on another code path.
    await as(test, can, 'POST', '/v1/friends', { username: veli.username });
    await as(test, veli, 'POST', `/v1/circles/${pair.id}/accept`);

    const again = await connectAs(veli);
    const reply = resumeReplySchema.parse(
      await again.emitWithAck('resume', { lastEventId: lastSeen }),
    );
    expect(reply.snapshot).toBe(false);
    expect(reply.events.map((e) => e.event.type)).toEqual(['circle.changed', 'circle.changed']);
    const ids = reply.events.map((e) => e.id);
    expect([...ids].sort()).toEqual(ids);

    const fresh = resumeReplySchema.parse(await again.emitWithAck('resume', { lastEventId: null }));
    expect(fresh).toEqual({ events: [], snapshot: true });
    const ancient = resumeReplySchema.parse(
      await again.emitWithAck('resume', { lastEventId: '1-0' }),
    );
    expect(ancient.snapshot).toBe(true);
  });

  it('closes the connection of a device that signs out or is replaced, and rekeys its circles', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const ayseSocket = await connectAs(ayse);
    const toAyse = collect(ayseSocket);
    const boraSocket = await connectAs(bora);
    const closed = new Promise<void>((resolve) => {
      boraSocket.once('disconnect', () => {
        resolve();
      });
    });

    // Bora signs in on a new phone: the old one is cut off, Ayşe hears of a new epoch.
    await login(test, bora.email);
    await closed;
    await vi.waitFor(() => {
      expect(toAyse.map((e) => e.event)).toContainEqual({
        type: 'circle.changed',
        circleId: circle.id,
        epoch: circle.epoch + 1,
      });
    });

    const signedOut = new Promise<void>((resolve) => {
      ayseSocket.once('disconnect', () => {
        resolve();
      });
    });
    await call(test.app, {
      url: '/v1/auth/logout',
      accessToken: ayse.session.accessToken,
      device: ayse.device,
    });
    await signedOut;
  });
});
