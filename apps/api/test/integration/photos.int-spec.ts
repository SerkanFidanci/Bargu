import {
  createSenderState,
  decryptMessage,
  encryptMessage,
  fromBase64url,
  generatePhotoKey,
  generateSenderKey,
  openProfilePhoto,
  randomUuid,
  ReplayGuard,
  sealProfilePhoto,
  toBase64url,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import type { Circle, MessageEnvelope, Photo } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

/** A small "JPEG": the server must never see these bytes in the clear. */
const IMAGE = new Uint8Array(3_000).map((_, index) => (index * 7) % 256);

function profileMessage(who: Person, circle: Circle, photo: { id: string; key: Uint8Array }) {
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  const { envelope } = encryptMessage({
    state: createSenderState(senderKey),
    sender: who.device,
    payload: {
      kind: 'profile',
      photo: { id: photo.id, key: toBase64url(photo.key) },
      ts: Date.now(),
    },
  });
  return { envelope, senderKey };
}

describe('encrypted profile photos', () => {
  it('reach circle-mates only, who open them with the key from the circle', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const photo = { id: randomUuid(), key: generatePhotoKey() };

    const sealed = sealProfilePhoto(photo.key, photo.id, IMAGE);
    const upload = await as(test, ayse, 'PUT', '/v1/me/photo', {
      photoId: photo.id,
      ciphertext: toBase64url(sealed),
    });
    expect(upload.statusCode).toBe(204);
    // The key travels inside an encrypted profile message, kept by the relay for the circle.
    const { envelope, senderKey } = profileMessage(ayse, circle, photo);
    expect(
      (await as(test, ayse, 'POST', '/v1/profile-keys', { envelopes: [envelope] })).json(),
    ).toEqual({ accepted: 1, refused: [] });

    // Bora: the message, then the photo, opened on his side.
    const snapshot = (await as(test, bora, 'GET', '/v1/profile-keys')).json<{
      envelopes: MessageEnvelope[];
    }>();
    expect(snapshot.envelopes).toHaveLength(1);
    const card = circle.members.find((member) => member.userId === ayse.userId)?.device;
    if (card === undefined || card === null) throw new Error('no device card');
    const payload = decryptMessage({
      envelope: snapshot.envelopes[0],
      senderKey,
      sender: verifyDeviceKeyBundle(card.bundle),
      replay: new ReplayGuard(),
    });
    if (payload.kind !== 'profile' || payload.photo === null) throw new Error('no photo key');
    const downloaded = (
      await as(test, bora, 'GET', `/v1/users/${ayse.userId}/photo`)
    ).json<Photo>();
    expect(downloaded.photoId).toBe(photo.id);
    const opened = openProfilePhoto(
      fromBase64url(payload.photo.key, 32),
      downloaded.photoId,
      fromBase64url(downloaded.ciphertext),
    );
    expect(opened).toEqual(IMAGE);

    // Someone outside every circle gets nothing, not even that a photo exists.
    expect((await as(test, mallory, 'GET', `/v1/users/${ayse.userId}/photo`)).statusCode).toBe(404);
    expect((await as(test, mallory, 'GET', '/v1/profile-keys')).json()).toEqual({ envelopes: [] });

    // The database holds ciphertext only.
    const { rows } = await test.admin.query<{ ciphertext: Buffer }>(
      'SELECT ciphertext FROM app.profile_photos WHERE user_id = $1',
      [ayse.userId],
    );
    expect(
      Buffer.from(rows[0]?.ciphertext ?? []).includes(Buffer.from(IMAGE.subarray(0, 64))),
    ).toBe(false);

    // Removed: gone for everyone.
    expect((await as(test, ayse, 'DELETE', '/v1/me/photo')).statusCode).toBe(204);
    expect((await as(test, bora, 'GET', `/v1/users/${ayse.userId}/photo`)).statusCode).toBe(404);
  });

  it('stops reaching someone who left the circle, and refuses oversized uploads', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const photo = { id: randomUuid(), key: generatePhotoKey() };
    await as(test, ayse, 'PUT', '/v1/me/photo', {
      photoId: photo.id,
      ciphertext: toBase64url(sealProfilePhoto(photo.key, photo.id, IMAGE)),
    });
    expect((await as(test, bora, 'GET', `/v1/users/${ayse.userId}/photo`)).statusCode).toBe(200);
    await as(test, bora, 'POST', `/v1/circles/${circle.id}/leave`);
    expect((await as(test, bora, 'GET', `/v1/users/${ayse.userId}/photo`)).statusCode).toBe(404);

    const tooBig = await as(test, ayse, 'PUT', '/v1/me/photo', {
      photoId: photo.id,
      ciphertext: 'A'.repeat(60_000),
    });
    expect(tooBig.statusCode).toBeGreaterThanOrEqual(400);
    expect(tooBig.statusCode).toBeLessThan(500);
  });
});
