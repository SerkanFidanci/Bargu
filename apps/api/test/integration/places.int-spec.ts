import {
  createSenderState,
  decryptStoredMessage,
  encryptMessage,
  generateSenderKey,
  randomUuid,
  type SenderState,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  MAX_PLACES_PER_CIRCLE,
  type MessageEnvelope,
  type PlacePayload,
  type PlaceRecord,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { createTestApp, type TestApp } from './support/app.js';
import { call } from './support/client.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

/** A member's phone: its sender key for the circle's epoch, sequence numbers kept. */
function phone(who: Person, circle: Pick<Circle, 'id' | 'epoch'>) {
  let state: SenderState = createSenderState(
    generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: who.device.deviceId,
    }),
  );
  return {
    key: state.senderKey,
    seal(place: PlacePayload): MessageEnvelope {
      const { envelope, nextState } = encryptMessage({ state, sender: who.device, payload: place });
      state = nextState;
      return envelope;
    },
  };
}

// The test proves the name and the coordinates never reach the server in any form.
const home = (id: string): PlacePayload => ({
  kind: 'place',
  id,
  name: 'Bizim ev',
  emoji: '🏠',
  lat: 41.008_237,
  lng: 28.978_359,
  radius: 250,
  ts: Date.now(),
});

const put = (
  who: Person,
  circleId: string,
  id: string,
  envelope: MessageEnvelope,
  version: number | null,
) => as(test, who, 'PUT', `/v1/circles/${circleId}/places/${id}`, { envelope, version });

const list = async (who: Person) =>
  (await as(test, who, 'GET', '/v1/places')).json<{ places: PlaceRecord[] }>().places;

describe('places', () => {
  it('are kept as ciphertext for the circle, changed version by version, deleted by members', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const aysePhone = phone(ayse, circle);
    const id = randomUuid();

    const saved = await put(ayse, circle.id, id, aysePhone.seal(home(id)), null);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ version: 1 });

    // Bora's phone lists it and opens it with Ayşe's key; the database holds no plaintext.
    const [record] = await list(bora);
    expect(record).toMatchObject({ circleId: circle.id, id, version: 1 });
    const author = circle.members.find((member) => member.userId === ayse.userId)?.device;
    if (record === undefined || author === undefined || author === null) {
      throw new Error('missing');
    }
    expect(
      decryptStoredMessage({
        envelope: record.envelope,
        senderKey: aysePhone.key,
        sender: verifyDeviceKeyBundle(author.bundle),
      }),
    ).toMatchObject({ name: 'Bizim ev', radius: 250 });
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(p)::text AS dump FROM app.places p WHERE id = $1`,
      [id],
    );
    for (const text of ['Bizim ev', '41.008', '28.978', '"radius"']) {
      expect(rows[0]?.dump).not.toContain(text);
    }
    // Bora heard about it (a small event naming the circle only), Ayşe did not need to. Read
    // from his stream itself: a resume cursor taken before could be null (QA 5c, flaky test).
    const stream = await test.app.get<RedisClient>(REDIS).xRange(`ev:${bora.userId}`, '-', '+');
    const heard = (stream ?? []).map(
      (entry) => (JSON.parse(entry.message.e ?? '{}') as { event?: unknown }).event,
    );
    expect(heard).toContainEqual({ type: 'places.changed', circleId: circle.id });

    // Changes go from the version read; a stale one is refused (someone saved in between).
    const boraPhone = phone(bora, circle);
    expect((await put(bora, circle.id, id, boraPhone.seal(home(id)), 1)).json()).toEqual({
      version: 2,
    });
    const stale = await put(ayse, circle.id, id, aysePhone.seal(home(id)), 1);
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    // The same id cannot be created twice.
    const twice = await put(ayse, circle.id, id, aysePhone.seal(home(id)), null);
    expect(twice.json()).toMatchObject({ code: 'VERSION_CONFLICT' });

    expect(
      (await as(test, bora, 'DELETE', `/v1/circles/${circle.id}/places/${id}`)).statusCode,
    ).toBe(204);
    expect(await list(ayse)).toEqual([]);
    expect(
      (await as(test, bora, 'DELETE', `/v1/circles/${circle.id}/places/${id}`)).statusCode,
    ).toBe(404);
  });

  it('are invisible and untouchable to anyone outside the circle', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const id = randomUuid();
    await put(ayse, circle.id, id, phone(ayse, circle).seal(home(id)), null);

    expect(await list(mallory)).toEqual([]);
    // Mallory signs with her own device: she is simply not a member (as if the circle did not exist).
    const intrude = await put(mallory, circle.id, id, phone(mallory, circle).seal(home(id)), 1);
    expect(intrude.statusCode).toBe(404);
    const drop = await as(test, mallory, 'DELETE', `/v1/circles/${circle.id}/places/${id}`);
    expect(drop.statusCode).toBe(404);
    expect(await list(bora)).toHaveLength(1);
  });

  it('refuse messages not signed by the caller, for another circle, or of an old epoch', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const other = await circleWith(test, ayse, bora);
    const id = randomUuid();

    // Bora's envelope sent by Ayşe: not her device.
    const borrowed = await put(ayse, circle.id, id, phone(bora, circle).seal(home(id)), null);
    expect(borrowed.statusCode).toBe(400);
    // Sealed for another circle than the one named in the path.
    const elsewhere = await put(ayse, circle.id, id, phone(ayse, other).seal(home(id)), null);
    expect(elsewhere.statusCode).toBe(400);
    // Sealed with an older epoch: new members could not open it.
    const old = await put(
      ayse,
      circle.id,
      id,
      phone(ayse, { ...circle, epoch: circle.epoch - 1 }).seal(home(id)),
      null,
    );
    expect(old.json()).toMatchObject({ code: 'EPOCH_STALE' });
    // Unsigned request (no device signature): refused before anything else.
    const unsigned = await call(test.app, {
      method: 'PUT',
      url: `/v1/circles/${circle.id}/places/${id}`,
      accessToken: ayse.session.accessToken,
      body: { envelope: phone(ayse, circle).seal(home(id)), version: null },
    });
    expect(unsigned.statusCode).toBe(401);
    expect(await list(bora)).toEqual([]);
  });

  it(`stop at ${String(MAX_PLACES_PER_CIRCLE)} per circle`, async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const aysePhone = phone(ayse, circle);
    for (let i = 0; i < MAX_PLACES_PER_CIRCLE; i++) {
      const id = randomUuid();
      expect((await put(ayse, circle.id, id, aysePhone.seal(home(id)), null)).statusCode).toBe(200);
    }
    const id = randomUuid();
    const full = await put(ayse, circle.id, id, aysePhone.seal(home(id)), null);
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: 'PLACES_FULL' });
  });
});
