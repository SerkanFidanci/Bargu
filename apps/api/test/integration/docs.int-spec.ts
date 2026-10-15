import {
  createSenderState,
  decryptDocument,
  encryptDocument,
  generateSenderKey,
  randomUuid,
  type SenderState,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  type DocPayload,
  type DocRecord,
  type Invite,
  MAX_DOCS_PER_CIRCLE,
  type MessageEnvelope,
} from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { EventsService } from '../../src/events/events.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { as, circleWith, type Person, person } from './support/people.js';

let test: TestApp;

beforeAll(async () => {
  test = await createTestApp();
});
afterAll(async () => {
  await test.close();
});

const HOUR = 3600_000;

/** An event with its owner and everyone else joined through its QR code. */
async function eventWith(owner: Person, ...others: Person[]): Promise<Circle> {
  const created = await as(test, owner, 'POST', '/v1/circles', {
    kind: 'event',
    name: 'Piknik',
    endsAt: Date.now() + 5 * HOUR,
  });
  if (created.statusCode !== 201) throw new Error(`create event: ${created.body}`);
  const event = created.json<Circle>();
  const qr = (
    await as(test, owner, 'POST', '/v1/invites', { kind: 'circle', circleId: event.id })
  ).json<Invite>();
  for (const who of others) {
    const joined = await as(test, who, 'POST', '/v1/invites/accept', { token: qr.token });
    if (joined.statusCode !== 200) throw new Error(`join: ${joined.body}`);
  }
  return (await as(test, owner, 'GET', `/v1/circles/${event.id}`)).json<Circle>();
}

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
    seal(payload: DocPayload): MessageEnvelope {
      const { envelope, nextState } = encryptDocument({ state, sender: who.device, payload });
      state = nextState;
      return envelope;
    },
  };
}

// The tests prove the time, the places and the votes never reach the server in any form.
const meeting = (circleId: string): DocPayload => ({
  kind: 'plan',
  id: circleId,
  meetAt: Date.UTC(2026, 9, 18, 16, 30),
  placeId: '0190f7a4-2222-7222-8222-000000000001',
  ts: Date.now(),
});
const pollOn = (id: string): DocPayload => ({
  kind: 'poll',
  id,
  by: '0190f7a4-1111-7111-8111-00000000a11c',
  about: 'place',
  options: [
    { placeId: '0190f7a4-2222-7222-8222-000000000001', name: 'Moda Sahili' },
    { placeId: '0190f7a4-2222-7222-8222-000000000002', name: 'Yoğurtçu Parkı' },
  ],
  ts: Date.now(),
});
const voteIn = (id: string, pollId: string): DocPayload => ({
  kind: 'vote',
  id,
  pollId,
  choices: [1],
  ts: Date.now(),
});

const put = (
  who: Person,
  circleId: string,
  id: string,
  envelope: MessageEnvelope,
  version: number | null,
  shared: boolean,
) => as(test, who, 'PUT', `/v1/circles/${circleId}/docs/${id}`, { envelope, version, shared });

const list = async (who: Person, circleId: string) =>
  (await as(test, who, 'GET', `/v1/circles/${circleId}/docs`)).json<{ docs: DocRecord[] }>().docs;

describe('event documents', () => {
  it('are kept as ciphertext, changed by every member when shared, opened by all', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const event = await eventWith(ayse, bora);
    const [aysePhone, boraPhone] = [phone(ayse, event), phone(bora, event)];

    const before = (await test.app.get(EventsService).since(bora.userId, null)).cursor;
    const saved = await put(
      ayse,
      event.id,
      event.id,
      aysePhone.seal(meeting(event.id)),
      null,
      true,
    );
    expect(saved.json()).toEqual({ version: 1 });

    // Bora lists it and opens it with Ayşe's key; the database holds no plaintext.
    const [record] = await list(bora, event.id);
    const author = event.members.find((member) => member.userId === ayse.userId)?.device;
    if (record === undefined || author === undefined || author === null) throw new Error('missing');
    expect(record).toMatchObject({ circleId: event.id, id: event.id, version: 1, shared: true });
    expect(
      decryptDocument({
        envelope: record.envelope,
        senderKey: aysePhone.key,
        sender: verifyDeviceKeyBundle(author.bundle),
      }),
    ).toMatchObject({ kind: 'plan', meetAt: Date.UTC(2026, 9, 18, 16, 30) });
    const pollId = randomUuid();
    await put(ayse, event.id, pollId, aysePhone.seal(pollOn(pollId)), null, true);
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(d)::text AS dump FROM app.circle_docs d WHERE circle_id = $1`,
      [event.id],
    );
    expect(rows).toHaveLength(2);
    for (const text of ['Moda', 'Yoğurtçu', 'plan', 'poll', 'meetAt', '2222-7222']) {
      expect(rows.map((row) => row.dump).join()).not.toContain(text);
    }
    const events = await test.app.get(EventsService).since(bora.userId, before);
    expect(events.events.map((delivered) => delivered.event)).toContainEqual({
      type: 'docs.changed',
      circleId: event.id,
    });

    // Shared: Bora changes Ayşe's meeting from the version he read; a stale save is refused.
    expect(
      (await put(bora, event.id, event.id, boraPhone.seal(meeting(event.id)), 1, true)).json(),
    ).toEqual({ version: 2 });
    const stale = await put(ayse, event.id, event.id, aysePhone.seal(meeting(event.id)), 1, true);
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    // Created twice, or "unshared" on the way: a conflict too.
    const twice = await put(
      ayse,
      event.id,
      event.id,
      aysePhone.seal(meeting(event.id)),
      null,
      true,
    );
    expect(twice.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    const unshared = await put(
      bora,
      event.id,
      event.id,
      boraPhone.seal(meeting(event.id)),
      2,
      false,
    );
    expect(unshared.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
  });

  it('keep votes to their author, and votes go when their author leaves', async () => {
    const [ayse, bora, can] = await Promise.all([person(test), person(test), person(test)]);
    const event = await eventWith(ayse, bora, can);
    const [aysePhone, boraPhone, canPhone] = [
      phone(ayse, event),
      phone(bora, event),
      phone(can, event),
    ];
    const pollId = randomUuid();
    await put(ayse, event.id, pollId, aysePhone.seal(pollOn(pollId)), null, true);
    const [boraVote, canVote] = [randomUuid(), randomUuid()];
    expect(
      (await put(bora, event.id, boraVote, boraPhone.seal(voteIn(boraVote, pollId)), null, false))
        .statusCode,
    ).toBe(200);
    await put(can, event.id, canVote, canPhone.seal(voteIn(canVote, pollId)), null, false);

    // Nobody else changes Bora's vote, not even the owner; Bora does.
    for (const [who, own] of [
      [ayse, aysePhone],
      [can, canPhone],
    ] as const) {
      const changed = await put(
        who,
        event.id,
        boraVote,
        own.seal(voteIn(boraVote, pollId)),
        1,
        false,
      );
      expect(changed.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    }
    expect(
      (
        await put(bora, event.id, boraVote, boraPhone.seal(voteIn(boraVote, pollId)), 1, false)
      ).json(),
    ).toEqual({ version: 2 });
    // Deleting: Can neither Bora's vote nor Ayşe's poll; the owner may delete anything.
    for (const id of [boraVote, pollId]) {
      expect((await as(test, can, 'DELETE', `/v1/circles/${event.id}/docs/${id}`)).statusCode).toBe(
        404,
      );
    }
    expect(
      (await as(test, ayse, 'DELETE', `/v1/circles/${event.id}/docs/${canVote}`)).statusCode,
    ).toBe(204);

    // Bora leaves: his vote goes with him, Ayşe's poll stays.
    expect((await as(test, bora, 'POST', `/v1/circles/${event.id}/leave`)).statusCode).toBe(204);
    expect((await list(ayse, event.id)).map((doc) => doc.id)).toEqual([pollId]);
  });

  it('are invisible and untouchable outside the event, and exist only in events', async () => {
    const [ayse, bora, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const event = await eventWith(ayse, bora);
    await put(ayse, event.id, event.id, phone(ayse, event).seal(meeting(event.id)), null, true);

    expect(await list(mallory, event.id)).toEqual([]);
    const intrude = await put(
      mallory,
      event.id,
      event.id,
      phone(mallory, event).seal(meeting(event.id)),
      1,
      true,
    );
    expect(intrude.statusCode).toBe(404);
    expect(
      (await as(test, mallory, 'DELETE', `/v1/circles/${event.id}/docs/${event.id}`)).statusCode,
    ).toBe(404);
    expect(await list(bora, event.id)).toHaveLength(1);

    // A group has no documents.
    const group = await circleWith(test, ayse, bora);
    const refused = await put(
      ayse,
      group.id,
      group.id,
      phone(ayse, group).seal(meeting(group.id)),
      null,
      true,
    );
    expect(refused.statusCode).toBe(403);
  });

  it('refuse documents not signed by the caller, for another circle, or of an old epoch', async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const event = await eventWith(ayse, bora);
    const other = await eventWith(ayse, bora);
    const id = event.id;

    const borrowed = await put(
      ayse,
      event.id,
      id,
      phone(bora, event).seal(meeting(id)),
      null,
      true,
    );
    expect(borrowed.statusCode).toBe(400);
    const elsewhere = await put(
      ayse,
      event.id,
      id,
      phone(ayse, other).seal(meeting(id)),
      null,
      true,
    );
    expect(elsewhere.statusCode).toBe(400);
    const old = await put(
      ayse,
      event.id,
      id,
      phone(ayse, { ...event, epoch: event.epoch - 1 }).seal(meeting(id)),
      null,
      true,
    );
    expect(old.json()).toMatchObject({ code: 'EPOCH_STALE' });
    expect(await list(bora, event.id)).toEqual([]);
  });

  it(`stop at ${String(MAX_DOCS_PER_CIRCLE)} per event`, async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const event = await eventWith(ayse, bora);
    const aysePhone = phone(ayse, event);
    const first = randomUuid();
    await put(ayse, event.id, first, aysePhone.seal(voteIn(first, first)), null, false);
    // The rest straight into the table: saving them one by one would hit the rate limit.
    await test.admin.query(
      `INSERT INTO app.circle_docs (circle_id, id, author_id, shared, envelope)
       SELECT circle_id, gen_random_uuid(), author_id, shared, envelope
         FROM app.circle_docs, generate_series(2, $2::int)
        WHERE circle_id = $1`,
      [event.id, MAX_DOCS_PER_CIRCLE],
    );
    const id = randomUuid();
    const full = await put(ayse, event.id, id, aysePhone.seal(voteIn(id, first)), null, false);
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: 'DOCS_FULL' });
  });
});
