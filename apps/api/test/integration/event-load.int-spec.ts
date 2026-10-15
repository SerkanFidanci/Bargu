import {
  createSenderKeyDistribution,
  createSenderState,
  encryptMessage,
  generateSenderKey,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import { type Circle, type Invite, publishReplySchema } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EVENT_INVITE_USES } from '../../src/circles/invites.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, type Person, person } from './support/people.js';

let test: TestApp;
beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

/** People joining at once, in waves (a crowd at the door, not one by one). */
const WAVE = 5;

/** Joins, then does what a phone does next: keys for everyone in, a location at that epoch. */
async function arrive(who: Person, qr: Invite) {
  const joined = await as(test, who, 'POST', '/v1/invites/accept', { token: qr.token });
  if (joined.statusCode !== 200) return { joined: false, keyed: false, epoch: 0 };
  const { circleId } = joined.json<{ circleId: string }>();
  const circle = (await as(test, who, 'GET', `/v1/circles/${circleId}`)).json<Circle>();
  const senderKey = generateSenderKey({
    circleId,
    epoch: circle.epoch,
    senderDeviceId: who.device.deviceId,
  });
  const distributions = circle.members.flatMap((member) =>
    member.userId === who.userId || member.device === null || member.status !== 'active'
      ? []
      : [
          createSenderKeyDistribution({
            senderKey,
            sender: who.device,
            recipient: verifyDeviceKeyBundle(member.device.bundle),
          }),
        ],
  );
  const keyed = await as(test, who, 'POST', `/v1/circles/${circleId}/keys`, {
    epoch: circle.epoch,
    distributions,
  });
  return {
    joined: true,
    keyed: keyed.statusCode === 204,
    epoch: circle.epoch,
    state: createSenderState(senderKey),
  };
}

describe('a 50-person event (QA Faz 8 O7, load)', () => {
  it('takes everyone in by one QR code within a minute, with bounded keys', async () => {
    const owner = await person(test, 'Düzenleyen');
    const event = (
      await as(test, owner, 'POST', '/v1/circles', {
        kind: 'event',
        name: 'Konser',
        endsAt: Date.now() + 3 * 3600_000,
      })
    ).json<Circle>();
    const qr = (
      await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: event.id })
    ).json<Invite>();
    // Accounts in waves too: 49 sign-ins at once would crowd out the other test files that share
    // the database.
    const crowd: Person[] = [];
    for (let i = 0; i < EVENT_INVITE_USES - 1; i += WAVE) {
      const size = Math.min(WAVE, EVENT_INVITE_USES - 1 - i);
      crowd.push(
        ...(await Promise.all(
          Array.from({ length: size }, (_, j) => person(test, `Kişi ${String(i + j)}`)),
        )),
      );
    }

    const started = Date.now();
    const arrivals: Awaited<ReturnType<typeof arrive>>[] = [];
    for (let i = 0; i < crowd.length; i += WAVE) {
      arrivals.push(...(await Promise.all(crowd.slice(i, i + WAVE).map((who) => arrive(who, qr)))));
    }
    const joinedIn = Date.now() - started;

    // Everyone then sends a location sealed at the epoch they keyed: the relay takes the current
    // epoch and the two before it, so the rest wait for the phone to key again (circle.changed).
    let accepted = 0;
    let refused = 0;
    for (const [index, arrival] of arrivals.entries()) {
      const who = crowd[index];
      if (who === undefined || arrival.state === undefined) continue;
      const { envelope } = encryptMessage({
        state: arrival.state,
        sender: who.device,
        payload: { kind: 'loc', lat: 41, lng: 29, acc: 9, bat: 80, chg: false, ts: Date.now() },
      });
      const reply = publishReplySchema.parse(
        (await as(test, who, 'POST', '/v1/locations', { envelopes: [envelope] })).json(),
      );
      accepted += reply.accepted;
      refused += reply.refused.length;
    }

    const final = (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>();
    const { rows } = await test.admin.query<{ rows: number; epochs: number }>(
      `SELECT count(*)::integer AS rows, count(DISTINCT epoch)::integer AS epochs
         FROM app.key_envelopes WHERE circle_id = $1`,
      [event.id],
    );
    const measured = {
      members: final.members.filter((member) => member.status === 'active').length,
      joinedInMs: joinedIn,
      finalEpoch: final.epoch,
      keyRows: rows[0]?.rows ?? 0,
      keyEpochsKept: rows[0]?.epochs ?? 0,
      keyedAtFirstTry: arrivals.filter((arrival) => arrival.keyed).length,
      locationsAccepted: accepted,
      locationsRefusedStaleEpoch: refused,
    };
    process.stdout.write(`O7 ${JSON.stringify(measured)}\n`);

    expect(measured.members).toBe(EVENT_INVITE_USES);
    expect(measured.joinedInMs).toBeLessThan(60_000);
    // Each join is a new epoch; the server keeps keys for the last three only.
    expect(measured.finalEpoch).toBe(EVENT_INVITE_USES);
    expect(measured.keyEpochsKept).toBeLessThanOrEqual(3);
    expect(measured.keyRows).toBeLessThanOrEqual(3 * EVENT_INVITE_USES * EVENT_INVITE_USES);
    // The last ones in are current; everyone else's first location waits for new keys.
    expect(measured.locationsAccepted).toBeGreaterThanOrEqual(1);
    expect(measured.locationsAccepted + measured.locationsRefusedStaleEpoch).toBe(crowd.length);
  }, 180_000);
});
