import {
  encryptChat,
  generateRequestNonce,
  generateSenderKey,
  randomUuid,
  signRequest,
} from '@bargu/crypto';
import {
  type ChatPayload,
  type Circle,
  CLIENT_LEVEL_FOR,
  CLIENT_LEVEL_QUERY,
  COMMUNITY_RULES_VERSION,
} from '@bargu/schemas';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVENTS_PATH } from '../../src/events/events.gateway.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

/**
 * Messages as live events (docs/ADR/0035 §6, §11; QA-38 O1 and the level finding): an app too old
 * for messages, or someone who blocked the sender, gets no `chat` event at all.
 */
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

/** A phone's live connection, at the client level it says. */
function connect(who: Person, level: number): Promise<Socket> {
  const nonce = generateRequestNonce();
  const ts = Date.now();
  return new Promise((resolve, reject) => {
    const socket = io(url, {
      path: EVENTS_PATH,
      transports: ['websocket'],
      reconnection: false,
      forceNew: true,
      query: { [CLIENT_LEVEL_QUERY]: String(level) },
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

/** Item ids each socket hears as `chat` events. */
function heard(socket: Socket): string[] {
  const ids: string[] = [];
  socket.on('chat', (event: { item: { id: string } }) => {
    ids.push(event.item.id);
  });
  return ids;
}

const send = async (who: Person, circle: Circle) => {
  const payload: ChatPayload = { kind: 'text', id: randomUuid(), text: 'Selam', ts: Date.now() };
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  const envelope = encryptChat({ senderKey, sender: who.device, payload });
  const reply = await as(test, who, 'POST', `/v1/chat/circles/${circle.id}`, { envelope });
  expect(reply.json()).toEqual({ ok: true });
  return envelope.id;
};
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

describe('messages as live events', () => {
  it('reach an app that reads them, not an older one, nor someone who blocked the sender', async () => {
    const [sender, reader, older, blocker] = await Promise.all([
      person(test, 'Gönderen'),
      person(test, 'Okuyan'),
      person(test, 'Eski'),
      person(test, 'Engelleyen'),
    ]);
    await as(test, sender, 'PUT', '/v1/me/rules', { version: COMMUNITY_RULES_VERSION });
    const circle = await circleWith(test, sender, reader, older, blocker);
    expect((await as(test, blocker, 'PUT', `/v1/blocks/${sender.userId}`)).statusCode).toBe(204);
    const toReader = heard(await connect(reader, CLIENT_LEVEL_FOR.messages));
    const toOlder = heard(await connect(older, CLIENT_LEVEL_FOR.messages - 1));
    const toBlocker = heard(await connect(blocker, CLIENT_LEVEL_FOR.messages));

    const id = await send(sender, circle);
    await settle();
    expect(toReader).toEqual([id]);
    expect(toOlder).toEqual([]);
    expect(toBlocker).toEqual([]);
  });
});
