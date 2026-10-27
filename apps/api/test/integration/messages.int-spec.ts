import {
  chatKeyOf,
  type DevicePublicKeys,
  encryptChat,
  fromBase64url,
  generatePhotoKey,
  generateSenderKey,
  openAtRest,
  photoHashOf,
  randomUuid,
  revealChatItem,
  sealChatPhoto,
  sealDirect,
  type SenderKey,
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { EmailJobs } from '../../src/jobs/email-jobs.js';
import { MessagesSweeper } from '../../src/messages/messages-sweeper.js';
import { REPORT_CONTENT_CONTEXT } from '../../src/messages/reports.service.js';
import { call } from './support/client.js';
import { createTestApp, type TestApp, testEnv } from './support/app.js';
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

/** The sender key a phone of `who` has for a circle's epoch. */
const keyOf = (who: Person, circle: Pick<Circle, 'id' | 'epoch'>): SenderKey =>
  generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });

/** An item of `who` for a circle, sealed with a sender key of the circle's epoch. */
function circleItem(
  who: Person,
  circle: Pick<Circle, 'id' | 'epoch'>,
  payload = text(),
  senderKey = keyOf(who, circle),
) {
  return encryptChat({ senderKey, sender: who.device, payload });
}

const sweeper = (env = test.env, email = test.app.get(EmailJobs)) =>
  new MessagesSweeper(test.app.get(DatabaseService), test.app.get<RedisClient>(REDIS), email, env);

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
    await sweeper().sweep();
    const left = await test.admin.query(
      `SELECT (SELECT count(*) FROM app.chat_items WHERE id = $1)::int AS items,
              (SELECT count(*) FROM app.media_blobs WHERE id = $2)::int AS files`,
      [envelope.id, orphanId],
    );
    expect(left.rows[0]).toEqual({ items: 0, files: 0 });
  });
});

describe('reports (docs/ADR/0035 §9)', () => {
  const report = (who: Person, body: object) => as(test, who, 'POST', '/v1/reports', body);
  const stored = async (reporter: Person) =>
    (
      await test.admin.query<{
        verified: boolean;
        content: string | null;
        reason: string;
        retain_until: Date | null;
        item_id: string | null;
      }>(
        `SELECT verified, content, reason, retain_until, item_id FROM app.reports
          WHERE reporter_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [reporter.userId],
      )
    ).rows[0];
  const opened = (content: string | null | undefined) =>
    JSON.parse(
      new TextDecoder().decode(
        openAtRest(test.env.JOB_PAYLOAD_KEY, content ?? '', REPORT_CONTENT_CONTEXT),
      ),
    ) as Record<string, unknown>;

  it('verify the item with its own key and keep what it said, sealed, for 90 days', async () => {
    const senderKey = keyOf(alice, family);
    const envelope = circleItem(alice, family, text('Seni bulacağım'), senderKey);
    await toCircle(alice, family.id, { envelope });
    const key = revealChatItem({
      envelope,
      chatKey: chatKeyOf(senderKey),
      sender: publicKeys(alice),
    });
    const filed = await report(bob, {
      userId: alice.userId,
      reason: 'harassment',
      item: { envelope, ...key },
    });
    expect(filed.statusCode).toBe(204);
    const row = await stored(bob);
    expect(row).toMatchObject({ verified: true, reason: 'harassment', item_id: envelope.id });
    expect(opened(row?.content)).toMatchObject({
      kind: 'text',
      text: 'Seni bulacağım',
      circleId: family.id,
    });
    const days = ((row?.retain_until?.getTime() ?? 0) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(89);
    // Nobody but the reporter sees the report exists.
    const seen = await test.app
      .get(DatabaseService)
      .asUser(carol.userId, (tx) => tx.execute('SELECT count(*)::int AS n FROM app.reports'));
    expect(seen.rows[0]).toEqual({ n: 0 });
  });

  it('keep a photo as it was sent, also after the sender took it back', async () => {
    const photoKey = generatePhotoKey();
    const blobId = randomUuid();
    const image = new Uint8Array(2000).fill(5);
    const sealed = sealChatPhoto(photoKey, blobId, image);
    await upload(carol, sealed, blobId);
    const senderKey = keyOf(carol, family);
    const photo: ChatPayload = {
      kind: 'photo',
      id: randomUuid(),
      blobId,
      key: toBase64url(photoKey),
      size: sealed.length,
      hash: photoHashOf(sealed),
      w: 10,
      h: 10,
      caption: 'bak',
      story: false,
      ts: Date.now(),
    };
    const envelope = circleItem(carol, family, photo, senderKey);
    await toCircle(carol, family.id, { envelope, blobId });
    const key = revealChatItem({
      envelope,
      chatKey: chatKeyOf(senderKey),
      sender: publicKeys(carol),
    });
    await as(test, carol, 'DELETE', `/v1/chat/${envelope.id}`);
    await report(alice, {
      userId: carol.userId,
      reason: 'sexual',
      item: { envelope, ...key },
      file: toBase64url(sealed),
    });
    const content = opened((await stored(alice))?.content);
    expect(content).toMatchObject({ kind: 'photo', caption: 'bak', story: false });
    expect(fromBase64url(String(content.image))).toEqual(image);
  });

  it('keep nothing of an item that does not verify, and keep child abuse until closed', async () => {
    const envelope = circleItem(alice, family);
    await toCircle(alice, family.id, { envelope });
    const forged = {
      key: toBase64url(new Uint8Array(32).fill(1)),
      nonce: toBase64url(new Uint8Array(12)),
    };
    const filed = await report(bob, {
      userId: alice.userId,
      reason: 'child',
      item: { envelope, ...forged },
    });
    expect(filed.statusCode).toBe(204);
    expect(await stored(bob)).toMatchObject({ verified: false, content: null, retain_until: null });
    await report(bob, { userId: carol.userId, reason: 'spam' });
    expect(await stored(bob)).toMatchObject({ verified: false, item_id: null, reason: 'spam' });
    expect((await report(bob, { userId: bob.userId, reason: 'spam' })).statusCode).toBe(400);
  });

  it('never take someone else’s item as theirs', async () => {
    const senderKey = keyOf(alice, family);
    const envelope = circleItem(alice, family, text(), senderKey);
    await toCircle(alice, family.id, { envelope });
    const key = revealChatItem({
      envelope,
      chatKey: chatKeyOf(senderKey),
      sender: publicKeys(alice),
    });
    await report(bob, { userId: carol.userId, reason: 'other', item: { envelope, ...key } });
    expect(await stored(bob)).toMatchObject({ verified: false, content: null });
  });
});

describe('the photos’ space (docs/ADR/0035 §10)', () => {
  const mediaBytes = async () =>
    Number(
      (await test.admin.query<{ bytes: string }>('SELECT app.media_bytes()::text AS bytes')).rows[0]
        ?.bytes,
    );

  it('warns the operator once a day past 80%, with no content', async () => {
    const bytes = await mediaBytes();
    await test.app.get<RedisClient>(REDIS).del('chat:media:alarm');
    const enqueueOps = vi.fn(() => Promise.resolve());
    const full = { ...test.env, MEDIA_MAX_BYTES: bytes, OPS_EMAIL: 'ops@example.test' };
    const watcher = sweeper(full, { enqueueOps } as unknown as EmailJobs);
    expect(await watcher.watchSpace()).toBeGreaterThanOrEqual(0.8);
    expect(await watcher.watchSpace()).toBeGreaterThanOrEqual(0.8);
    expect(enqueueOps).toHaveBeenCalledTimes(1);
    expect(enqueueOps).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'ops@example.test', topic: 'media' }),
    );
  });

  it('refuses a new photo once full; the words keep going', async () => {
    const small = await createTestApp({
      env: testEnv({ MEDIA_MAX_BYTES: String((await mediaBytes()) + 1_000_000) }),
    });
    try {
      const who = await person(small, 'Dolu');
      const send = (id: string) =>
        as(small, who, 'POST', '/v1/media', {
          id,
          bytes: toBase64url(
            sealChatPhoto(generatePhotoKey(), id, new Uint8Array(600 * 1024 - 61)),
          ),
        });
      expect((await send(randomUuid())).statusCode).toBe(204);
      const refused = await send(randomUuid());
      expect(refused.statusCode).toBe(507);
      expect(refused.json<{ code: string }>().code).toBe('MEDIA_FULL');
    } finally {
      await small.close();
    }
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
