import {
  type DevicePublicKeys,
  encryptChat,
  generatePhotoKey,
  generateSenderKey,
  photoHashOf,
  randomUuid,
  sealChatPhoto,
  sealDirect,
  toBase64url,
} from '@bargu/crypto';
import type {
  ChatPayload,
  ChatRecord,
  ChatSendReply,
  Circle,
  DirectEnvelope,
  Media,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { MessagesSweeper } from '../../src/messages/messages-sweeper.js';
import { call } from './support/client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;
let alice: Person;
let bob: Person;
let carol: Person;
let stranger: Person;
let family: Circle;

beforeAll(async () => {
  test = await createTestApp();
  [alice, bob, carol, stranger] = await Promise.all([
    person(test, 'Alice'),
    person(test, 'Bob'),
    person(test, 'Carol'),
    person(test, 'Yabancı'),
  ]);
  family = await circleWith(test, alice, bob, carol);
});
afterAll(async () => {
  await test.close();
});

const text = (words = 'Merhaba'): ChatPayload => ({
  kind: 'text',
  id: randomUuid(),
  text: words,
  ts: Date.now(),
});
const publicKeys = (who: Person): DevicePublicKeys => ({
  deviceId: who.device.deviceId,
  identityKey: who.device.identity.publicKey,
  dhKey: who.device.dh.publicKey,
});

/** An item of `who` for a circle, sealed with a sender key of the circle's epoch. */
function circleItem(who: Person, circle: Pick<Circle, 'id' | 'epoch'>, payload = text()) {
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  return encryptChat({ senderKey, sender: who.device, payload });
}

const toCircle = async (who: Person, circleId: string, body: object) =>
  (await as(test, who, 'POST', `/v1/chat/circles/${circleId}`, body)).json<ChatSendReply>();
const toPerson = async (who: Person, userId: string, body: object) =>
  (await as(test, who, 'POST', `/v1/chat/people/${userId}`, body)).json<ChatSendReply>();
const list = async (who: Person, after = 0) =>
  (await as(test, who, 'GET', `/v1/chat?after=${String(after)}`)).json<{ items: ChatRecord[] }>()
    .items;
const ids = (items: ChatRecord[]) => items.map((item) => item.id);
const upload = (who: Person, sealed: Uint8Array, id = randomUuid()) =>
  as(test, who, 'POST', '/v1/media', { id, bytes: toBase64url(sealed) }).then((response) => ({
    response,
    id,
  }));

describe('items for a circle (docs/ADR/0035 §2, §6)', () => {
  it('reach the circle and nobody else', async () => {
    const envelope = circleItem(alice, family);
    expect(await toCircle(alice, family.id, { envelope })).toEqual({ ok: true });
    for (const member of [alice, bob, carol])
      expect(ids(await list(member))).toContain(envelope.id);
    expect(ids(await list(stranger))).not.toContain(envelope.id);
    const [record] = (await list(bob)).filter((item) => item.id === envelope.id);
    expect(record).toMatchObject({
      senderId: alice.userId,
      circleId: family.id,
      recipientId: null,
      envelope,
      blobId: null,
    });
  });

  it('are refused from a stranger, another device, another epoch or another circle id', async () => {
    expect(await toCircle(stranger, family.id, { envelope: circleItem(stranger, family) })).toEqual(
      { refused: 'NOT_MEMBER' },
    );
    expect(await toCircle(bob, family.id, { envelope: circleItem(alice, family) })).toEqual({
      refused: 'INVALID',
    });
    const ahead = circleItem(alice, { id: family.id, epoch: family.epoch + 1 });
    expect(await toCircle(alice, family.id, { envelope: ahead })).toEqual({ refused: 'EPOCH' });
    const other = await circleWith(test, carol, alice);
    expect(await toCircle(alice, other.id, { envelope: circleItem(alice, family) })).toEqual({
      refused: 'INVALID',
    });
  });

  it('are the same item when sent again, and an id is never taken over', async () => {
    const envelope = circleItem(alice, family);
    expect(await toCircle(alice, family.id, { envelope })).toEqual({ ok: true });
    expect(await toCircle(alice, family.id, { envelope })).toEqual({ ok: true });
    expect(ids(await list(bob)).filter((id) => id === envelope.id)).toHaveLength(1);
  });

  it('go to a pair as items for the person, never as a circle’s', async () => {
    const asked = await as(test, bob, 'POST', '/v1/friends', { username: carol.username });
    const pair = asked.json<Circle>();
    await as(test, carol, 'POST', `/v1/circles/${pair.id}/accept`);
    expect(await toCircle(bob, pair.id, { envelope: circleItem(bob, pair) })).toEqual({
      refused: 'INVALID',
    });
  });

  it('leave with their sender, and the sender takes one back from everyone', async () => {
    const kept = circleItem(carol, family);
    const taken = circleItem(carol, family);
    await toCircle(carol, family.id, { envelope: kept });
    await toCircle(carol, family.id, { envelope: taken });
    expect((await as(test, bob, 'DELETE', `/v1/chat/${taken.id}`)).statusCode).toBe(404);
    expect((await as(test, carol, 'DELETE', `/v1/chat/${taken.id}`)).statusCode).toBe(204);
    expect(ids(await list(bob))).not.toContain(taken.id);
    expect(ids(await list(bob))).toContain(kept.id);

    const leaving = await person(test, 'Giden');
    const circle = await circleWith(test, alice, leaving);
    const said = circleItem(leaving, circle);
    await toCircle(leaving, circle.id, { envelope: said });
    expect(ids(await list(alice))).toContain(said.id);
    expect((await as(test, leaving, 'POST', `/v1/circles/${circle.id}/leave`)).statusCode).toBe(
      204,
    );
    expect(ids(await list(alice))).not.toContain(said.id);
  });

  it('are not shown to someone who joined after they were sent', async () => {
    const circle = await circleWith(test, alice, bob);
    const before = circleItem(alice, circle);
    await toCircle(alice, circle.id, { envelope: before });
    const late = await person(test, 'Geç');
    await as(test, alice, 'POST', `/v1/circles/${circle.id}/members`, { username: late.username });
    await as(test, late, 'POST', `/v1/circles/${circle.id}/accept`);
    expect(ids(await list(late))).not.toContain(before.id);
  });
});

describe('items for one person (docs/ADR/0035 §3)', () => {
  const sealFor = (from: Person, to: Person, payload = text()): DirectEnvelope =>
    sealDirect({ sender: from.device, recipient: publicKeys(to), payload });

  it('reach that person and nobody else', async () => {
    const envelope = sealFor(alice, bob);
    expect(await toPerson(alice, bob.userId, { envelope })).toEqual({ ok: true });
    expect(ids(await list(bob))).toContain(envelope.id);
    expect(ids(await list(alice))).toContain(envelope.id);
    expect(ids(await list(carol))).not.toContain(envelope.id);
  });

  it('need a shared circle and the person’s current device', async () => {
    expect(await toPerson(alice, stranger.userId, { envelope: sealFor(alice, stranger) })).toEqual({
      refused: 'NOT_MEMBER',
    });
    expect(await toPerson(alice, bob.userId, { envelope: sealFor(alice, carol) })).toEqual({
      refused: 'EPOCH',
    });
    expect(await toPerson(alice, alice.userId, { envelope: sealFor(alice, bob) })).toEqual({
      refused: 'INVALID',
    });
  });
});

describe('blocking (docs/ADR/0035 §6)', () => {
  it('hides what the blocked person sends, quietly, and is nobody else’s business', async () => {
    const blocker = await person(test, 'Engelleyen');
    const pest = await person(test, 'Rahatsız');
    const witness = await person(test, 'Tanık');
    const circle = await circleWith(test, witness, blocker, pest);
    expect((await as(test, blocker, 'PUT', `/v1/blocks/${pest.userId}`)).statusCode).toBe(204);
    expect(
      (await as(test, blocker, 'GET', '/v1/blocks')).json<{ blocked: string[] }>().blocked,
    ).toEqual([pest.userId]);
    expect(
      (await as(test, pest, 'GET', '/v1/blocks')).json<{ blocked: string[] }>().blocked,
    ).toEqual([]);

    const direct = sealDirect({
      sender: pest.device,
      recipient: publicKeys(blocker),
      payload: text(),
    });
    expect(await toPerson(pest, blocker.userId, { envelope: direct })).toEqual({ ok: true });
    expect(ids(await list(blocker))).not.toContain(direct.id);
    expect(ids(await list(pest))).not.toContain(direct.id);

    const said = circleItem(pest, circle);
    await toCircle(pest, circle.id, { envelope: said });
    expect(ids(await list(blocker))).not.toContain(said.id);
    expect(ids(await list(witness))).toContain(said.id);

    expect((await as(test, blocker, 'DELETE', `/v1/blocks/${pest.userId}`)).statusCode).toBe(204);
    expect(ids(await list(blocker))).toContain(said.id);
    expect((await as(test, blocker, 'PUT', `/v1/blocks/${blocker.userId}`)).statusCode).toBe(400);
  });
});

describe('photo files (docs/ADR/0035 §4)', () => {
  it('reach only those who can read an item that shares them', async () => {
    const key = generatePhotoKey();
    const blobId = randomUuid();
    const sealed = sealChatPhoto(key, blobId, new Uint8Array(400 * 1024).fill(7));
    const { response } = await upload(alice, sealed, blobId);
    expect(response.statusCode).toBe(204);
    const fetch = (who: Person) => as(test, who, 'GET', `/v1/media/${blobId}`);
    expect((await fetch(alice)).json<Media>().bytes).toBe(toBase64url(sealed));
    // Uploaded but not shared yet: nobody else sees it.
    expect((await fetch(bob)).statusCode).toBe(404);

    const photo: ChatPayload = {
      kind: 'photo',
      id: randomUuid(),
      blobId,
      key: toBase64url(key),
      size: sealed.length,
      hash: photoHashOf(sealed),
      w: 1200,
      h: 900,
      story: true,
      ts: Date.now(),
    };
    expect(
      await toCircle(alice, family.id, { envelope: circleItem(alice, family, photo), blobId }),
    ).toEqual({ ok: true });
    expect((await fetch(bob)).json<Media>().bytes).toBe(toBase64url(sealed));
    expect((await fetch(stranger)).statusCode).toBe(404);
    // Someone else's file cannot be attached to one's own item.
    expect(await toCircle(bob, family.id, { envelope: circleItem(bob, family), blobId })).toEqual({
      refused: 'INVALID',
    });
  });

  it('take a full-size photo through the larger body limit, and nothing larger', async () => {
    const blobId = randomUuid();
    const largest = sealChatPhoto(generatePhotoKey(), blobId, new Uint8Array(600 * 1024 - 61));
    expect((await upload(carol, largest, blobId)).response.statusCode).toBe(204);
    const tooLarge = (await upload(carol, new Uint8Array(600 * 1024 + 1))).response;
    expect(tooLarge.statusCode).toBe(400);
  });
});

describe('the 24 hours (docs/ADR/0035 §7)', () => {
  it('end: expired items are never shown, and the sweep deletes items and unshared files', async () => {
    const envelope = circleItem(bob, family);
    await toCircle(bob, family.id, { envelope });
    const orphan = sealChatPhoto(generatePhotoKey(), randomUuid(), new Uint8Array(100));
    const { id: orphanId } = await upload(bob, orphan);
    await test.admin.query(
      `UPDATE app.chat_items SET expires_at = now() - interval '1 second' WHERE id = $1`,
      [envelope.id],
    );
    await test.admin.query(
      `UPDATE app.media_blobs SET created_at = now() - interval '11 minutes' WHERE id = $1`,
      [orphanId],
    );
    expect(ids(await list(carol))).not.toContain(envelope.id);
    await new MessagesSweeper(
      test.app.get(DatabaseService),
      test.app.get<RedisClient>(REDIS),
    ).sweep();
    const left = await test.admin.query(
      `SELECT (SELECT count(*) FROM app.chat_items WHERE id = $1)::int AS items,
              (SELECT count(*) FROM app.media_blobs WHERE id = $2)::int AS files`,
      [envelope.id, orphanId],
    );
    expect(left.rows[0]).toEqual({ items: 0, files: 0 });
  });
});

describe('older apps (docs/ADR/0035 §11)', () => {
  it('are told to update before reaching messages', async () => {
    const response = await call(test.app, {
      method: 'GET',
      url: '/v1/chat?after=0',
      accessToken: alice.session.accessToken,
      clientLevel: 5,
    });
    expect(response.statusCode).toBe(426);
  });

  it('keep every other route: the server’s minimum level is unchanged', async () => {
    const response = await call(test.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: alice.session.accessToken,
      clientLevel: 5,
    });
    expect(response.statusCode).toBe(200);
  });
});
