import {
  BarguCryptoError,
  createSenderKeyDistribution,
  createSenderState,
  decryptMessage,
  encryptMessage,
  generateDeviceKeys,
  generateSenderKey,
  openSenderKeyDistribution,
  randomUuid,
  ReplayGuard,
  type SenderKey,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import type { Circle, MemberCard, SenderKeyDistribution } from '@bargu/schemas';
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

const location = {
  kind: 'loc' as const,
  lat: 41.0082,
  lng: 28.9784,
  acc: 12,
  bat: 80,
  chg: false,
  ts: Date.now(),
};

/** The value, or a test failure naming what was missing. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

async function fetchCircle(who: Person, circleId: string): Promise<Circle> {
  return (await as(test, who, 'GET', `/v1/circles/${circleId}`)).json<Circle>();
}

/** What the app does at a new epoch: its own sender key, wrapped for every other active member. */
function distribute(sender: Person, circle: Circle, recipients?: MemberCard[]) {
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch: circle.epoch,
    senderDeviceId: sender.device.deviceId,
  });
  const targets = (recipients ?? circle.members).filter(
    (member) => member.userId !== sender.userId && member.device !== null,
  );
  const distributions = targets.map((member) =>
    createSenderKeyDistribution({
      senderKey,
      sender: sender.device,
      recipient: verifyDeviceKeyBundle(member.device?.bundle),
    }),
  );
  return { senderKey, distributions };
}

async function keysFor(who: Person, circleId: string): Promise<SenderKeyDistribution[]> {
  const response = await as(test, who, 'GET', `/v1/circles/${circleId}/keys`);
  return response.json<{ distributions: SenderKeyDistribution[] }>().distributions;
}

function open(who: Person, sender: Person, distribution: SenderKeyDistribution): SenderKey {
  return openSenderKeyDistribution({
    distribution,
    recipient: who.device,
    sender: {
      deviceId: sender.device.deviceId,
      identityKey: sender.device.identity.publicKey,
      dhKey: sender.device.dh.publicKey,
    },
  });
}

describe('sender-key distribution', () => {
  it('reaches each active member for the current epoch, through the server, unreadable to it', async () => {
    const [ayse, bora, cem] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora, cem);
    const { senderKey, distributions } = distribute(ayse, circle);
    const upload = await as(test, ayse, 'POST', `/v1/circles/${circle.id}/keys`, {
      epoch: circle.epoch,
      distributions,
    });
    expect(upload.statusCode).toBe(204);

    const [mine] = await keysFor(bora, circle.id);
    expect(mine?.recipientDeviceId).toBe(bora.device.deviceId);
    const opened = open(bora, ayse, must(mine, 'distribution'));
    expect(opened.key).toEqual(senderKey.key);

    // The stored form is the signed ciphertext; the sender key itself never reaches the server.
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT envelope::text AS dump FROM app.key_envelopes WHERE circle_id = $1`,
      [circle.id],
    );
    const raw = Buffer.from(senderKey.key).toString('base64url');
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.dump).not.toContain(raw);
  });

  it('is refused for an old epoch, a forged signature, a stranger and a misaddressed copy', async () => {
    const [ayse, bora, stranger] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    const valid = distribute(ayse, circle).distributions;
    const post = (who: Person, body: unknown) =>
      as(test, who, 'POST', `/v1/circles/${circle.id}/keys`, body);

    expect(
      (await post(ayse, { epoch: circle.epoch - 1, distributions: valid })).json(),
    ).toMatchObject({
      code: 'EPOCH_STALE',
    });

    // Signed by another device's identity key.
    const impostor = generateDeviceKeys(ayse.device.deviceId);
    const forged = distribute({ ...ayse, device: impostor }, circle).distributions;
    expect((await post(ayse, { epoch: circle.epoch, distributions: forged })).json()).toMatchObject(
      {
        code: 'KEYS_INVALID',
      },
    );

    // Addressed to someone outside the circle.
    const outsiderCard: MemberCard = {
      userId: stranger.userId,
      role: 'member',
      status: 'active',
      username: stranger.username,
      displayName: null,
      avatar: null,
      device: {
        platform: 'android',
        bundle: {
          deviceId: stranger.device.deviceId,
          identityKey: Buffer.from(stranger.device.identity.publicKey).toString('base64url'),
          dhKey: Buffer.from(stranger.device.dh.publicKey).toString('base64url'),
          dhKeySignature: Buffer.from(stranger.device.dhKeySignature).toString('base64url'),
        },
      },
    };
    const toStranger = distribute(ayse, circle, [outsiderCard]).distributions;
    expect(
      (await post(ayse, { epoch: circle.epoch, distributions: toStranger })).json(),
    ).toMatchObject({
      code: 'KEYS_INVALID',
    });

    // A stranger cannot upload into the circle at all.
    expect((await post(stranger, { epoch: circle.epoch, distributions: valid })).statusCode).toBe(
      404,
    );
    expect((await as(test, stranger, 'GET', `/v1/circles/${circle.id}/keys`)).statusCode).toBe(404);
  });

  it('leaves a removed member unable to read the new epoch (Faz 4 DoD)', async () => {
    const [ayse, bora, cem] = await Promise.all([person(test), person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora, cem);

    // Epoch N: everyone holds Ayşe's sender key.
    const before = distribute(ayse, circle);
    await as(test, ayse, 'POST', `/v1/circles/${circle.id}/keys`, {
      epoch: circle.epoch,
      distributions: before.distributions,
    });
    const cemKeys = (await keysFor(cem, circle.id)).map((d) => open(cem, ayse, d));
    expect(cemKeys).toHaveLength(1);

    // Cem is removed: the circle moves to epoch N + 1 and Cem's device is no longer a recipient.
    const after = (
      await as(test, ayse, 'POST', `/v1/circles/${circle.id}/members/${cem.userId}/remove`)
    ).json<Circle>();
    expect(after.epoch).toBe(circle.epoch + 1);
    expect(after.members.some((m) => m.userId === cem.userId)).toBe(false);
    const next = distribute(ayse, after);
    expect(next.distributions.map((d) => d.recipientDeviceId)).toEqual([bora.device.deviceId]);
    await as(test, ayse, 'POST', `/v1/circles/${circle.id}/keys`, {
      epoch: after.epoch,
      distributions: next.distributions,
    });
    // Handing the new key to Cem anyway is refused by the server.
    const sneaky = distribute(
      ayse,
      after,
      circle.members.filter((m) => m.userId === cem.userId),
    );
    expect(
      (
        await as(test, ayse, 'POST', `/v1/circles/${circle.id}/keys`, {
          epoch: after.epoch,
          distributions: sneaky.distributions,
        })
      ).json(),
    ).toMatchObject({ code: 'KEYS_INVALID' });

    // A message of the new epoch: Bora reads it, Cem (old key only) cannot.
    const { envelope } = encryptMessage({
      state: createSenderState(next.senderKey),
      sender: ayse.device,
      payload: location,
    });
    const ayseKeys = verifyDeviceKeyBundle(
      after.members.find((m) => m.userId === ayse.userId)?.device?.bundle,
    );
    const [boraCopy] = (await keysFor(bora, circle.id)).filter((d) => d.epoch === after.epoch);
    expect(
      decryptMessage({
        envelope,
        senderKey: open(bora, ayse, must(boraCopy, 'distribution')),
        sender: ayseKeys,
        replay: new ReplayGuard(),
      }),
    ).toMatchObject({ kind: 'loc' });
    expect((await as(test, cem, 'GET', `/v1/circles/${circle.id}/keys`)).statusCode).toBe(404);
    expect(() =>
      decryptMessage({
        envelope,
        senderKey: must(cemKeys[0], 'old key'),
        sender: ayseKeys,
        replay: new ReplayGuard(),
      }),
    ).toThrow(BarguCryptoError);
  });

  it('starts a new epoch in every circle when a member signs in on a new phone', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const circle = await circleWith(test, ayse, bora);
    // The login service announces a new device through DeviceLifecycle (covered end to end in the
    // events test); here the announcement itself.
    const { DeviceLifecycle } = await import('../../src/devices/device-lifecycle.js');
    await test.app.get(DeviceLifecycle).notify({
      userId: bora.userId,
      kind: 'login',
      deviceId: randomUuid(),
      replacedDeviceId: bora.device.deviceId,
    });
    expect((await fetchCircle(ayse, circle.id)).epoch).toBe(circle.epoch + 1);
  });
});
