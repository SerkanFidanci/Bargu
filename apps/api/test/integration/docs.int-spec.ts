import {
  createSenderState,
  decryptDocument,
  encryptDocument,
  generateSenderKey,
  randomUuid,
  type SenderState,
  verifyDeviceKeyBundle,
  voteId,
} from '@bargu/crypto';
import {
  type Circle,
  type DocPayload,
  type DocRecord,
  type Invite,
  MAX_DOCS_PER_CIRCLE,
  MAX_POLLS_PER_MEMBER,
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

type Kind = 'plan' | 'poll' | { vote: string };

/** Saves a document as the phones do: a vote names its poll. */
const put = (
  who: Person,
  circleId: string,
  id: string,
  envelope: MessageEnvelope,
  version: number | null,
  kind: Kind,
) =>
  as(test, who, 'PUT', `/v1/circles/${circleId}/docs/${id}`, {
    envelope,
    version,
    kind: typeof kind === 'string' ? kind : 'vote',
    pollId: typeof kind === 'string' ? null : kind.vote,
  });

/** An admin makes someone admin (`owner`) or takes it back. */
const makeAdmin = async (by: Person, circleId: string, who: Person) => {
  const made = await as(test, by, 'POST', `/v1/circles/${circleId}/members/${who.userId}/role`, {
    role: 'owner',
  });
  if (made.statusCode !== 200) throw new Error(`make admin: ${made.body}`);
};

const list = async (who: Person, circleId: string) =>
  (await as(test, who, 'GET', `/v1/circles/${circleId}/docs`)).json<{ docs: DocRecord[] }>().docs;

describe('event documents', () => {
  it('are kept as ciphertext, set by the admins, opened by all', async () => {
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
      'plan',
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
    await put(ayse, event.id, pollId, aysePhone.seal(pollOn(pollId)), null, 'poll');
    const { rows } = await test.admin.query<{ dump: string }>(
      `SELECT row_to_json(d)::text AS dump FROM app.circle_docs d WHERE circle_id = $1`,
      [event.id],
    );
    expect(rows).toHaveLength(2);
    // The server knows which is the meeting and which a poll (docs/ADR/0020), never what they say.
    for (const text of ['Moda', 'Yoğurtçu', 'meetAt', '2222-7222', 'options']) {
      expect(rows.map((row) => row.dump).join()).not.toContain(text);
    }
    const events = await test.app.get(EventsService).since(bora.userId, before);
    expect(events.events.map((delivered) => delivered.event)).toContainEqual({
      type: 'docs.changed',
      circleId: event.id,
    });

    // Only admins set the meeting (docs/ADR/0020); once one, Bora changes Ayşe's meeting from the
    // version he read, and a stale save is refused.
    const byMember = await put(
      bora,
      event.id,
      event.id,
      boraPhone.seal(meeting(event.id)),
      1,
      'plan',
    );
    expect(byMember.statusCode).toBe(403);
    expect(byMember.json()).toMatchObject({ code: 'FORBIDDEN' });
    await makeAdmin(ayse, event.id, bora);
    expect(
      (await put(bora, event.id, event.id, boraPhone.seal(meeting(event.id)), 1, 'plan')).json(),
    ).toEqual({ version: 2 });
    const stale = await put(ayse, event.id, event.id, aysePhone.seal(meeting(event.id)), 1, 'plan');
    expect(stale.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    // Created twice: a conflict too. The meeting passed off as a poll or a vote: refused.
    const twice = await put(
      ayse,
      event.id,
      event.id,
      aysePhone.seal(meeting(event.id)),
      null,
      'plan',
    );
    expect(twice.json()).toMatchObject({ code: 'VERSION_CONFLICT' });
    for (const kind of ['poll', { vote: pollId }] as const) {
      const disguised = await put(
        bora,
        event.id,
        event.id,
        boraPhone.seal(meeting(event.id)),
        2,
        kind,
      );
      expect(disguised.statusCode).toBe(400);
    }
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
    await put(ayse, event.id, pollId, aysePhone.seal(pollOn(pollId)), null, 'poll');
    const [boraVote, canVote] = [voteId(pollId, bora.userId), voteId(pollId, can.userId)];
    const inPoll = { vote: pollId };
    expect(
      (await put(bora, event.id, boraVote, boraPhone.seal(voteIn(boraVote, pollId)), null, inPoll))
        .statusCode,
    ).toBe(200);
    await put(can, event.id, canVote, canPhone.seal(voteIn(canVote, pollId)), null, inPoll);

    // Nobody else changes Bora's vote, not even the owner (it is filed under Bora); Bora does.
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
        inPoll,
      );
      expect(changed.statusCode).toBe(400);
    }
    expect(
      (
        await put(bora, event.id, boraVote, boraPhone.seal(voteIn(boraVote, pollId)), 1, inPoll)
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
    await put(ayse, event.id, event.id, phone(ayse, event).seal(meeting(event.id)), null, 'plan');

    expect(await list(mallory, event.id)).toEqual([]);
    const intrude = await put(
      mallory,
      event.id,
      event.id,
      phone(mallory, event).seal(meeting(event.id)),
      1,
      'plan',
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
      'plan',
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
      'plan',
    );
    expect(borrowed.statusCode).toBe(400);
    const elsewhere = await put(
      ayse,
      event.id,
      id,
      phone(ayse, other).seal(meeting(id)),
      null,
      'plan',
    );
    expect(elsewhere.statusCode).toBe(400);
    const old = await put(
      ayse,
      event.id,
      id,
      phone(ayse, { ...event, epoch: event.epoch - 1 }).seal(meeting(id)),
      null,
      'plan',
    );
    expect(old.json()).toMatchObject({ code: 'EPOCH_STALE' });
    expect(await list(bora, event.id)).toEqual([]);
  });

  it(`stop at ${String(MAX_DOCS_PER_CIRCLE)} per event`, async () => {
    const [ayse, bora] = await Promise.all([person(test), person(test)]);
    const event = await eventWith(ayse, bora);
    const aysePhone = phone(ayse, event);
    const first = randomUuid();
    await put(ayse, event.id, first, aysePhone.seal(pollOn(first)), null, 'poll');
    // The rest straight into the table (by someone else, so that no member's poll quota is what
    // stops it): saving them one by one would hit the rate limit.
    await test.admin.query(
      `INSERT INTO app.circle_docs (circle_id, id, author_id, shared, kind, envelope)
       SELECT circle_id, gen_random_uuid(), $3, shared, kind, envelope
         FROM app.circle_docs, generate_series(2, $2::int)
        WHERE circle_id = $1`,
      [event.id, MAX_DOCS_PER_CIRCLE, bora.userId],
    );
    const id = voteId(first, ayse.userId);
    const full = await put(ayse, event.id, id, aysePhone.seal(voteIn(id, first)), null, {
      vote: first,
    });
    expect(full.statusCode).toBe(409);
    expect(full.json()).toMatchObject({ code: 'DOCS_FULL' });
  });

  it('hold their own rules on the server: admins run the meeting and polls, members vote (O4)', async () => {
    const [owner, bora, can] = await Promise.all([person(test), person(test), person(test)]);
    const event = await eventWith(owner, bora, can);
    const other = await eventWith(owner, bora);
    const [ownerPhone, boraPhone, canPhone] = [
      phone(owner, event),
      phone(bora, event),
      phone(can, event),
    ];
    const pollId = randomUuid();
    // A member starts no poll and sets no meeting; an admin does.
    const unasked = await put(bora, event.id, pollId, boraPhone.seal(pollOn(pollId)), null, 'poll');
    expect(unasked.statusCode).toBe(403);
    const meetingByCan = await put(
      can,
      event.id,
      event.id,
      canPhone.seal(meeting(event.id)),
      null,
      'plan',
    );
    expect(meetingByCan.statusCode).toBe(403);
    await makeAdmin(owner, event.id, bora);
    expect(
      (await put(bora, event.id, pollId, boraPhone.seal(pollOn(pollId)), null, 'poll')).statusCode,
    ).toBe(200);

    // Only admins change a poll (closing it says which option won).
    const byCan = await put(can, event.id, pollId, canPhone.seal(pollOn(pollId)), 1, 'poll');
    expect(byCan.statusCode).toBe(403);
    expect(byCan.json()).toMatchObject({ code: 'FORBIDDEN' });
    expect(
      (await put(owner, event.id, pollId, ownerPhone.seal(pollOn(pollId)), 1, 'poll')).json(),
    ).toEqual({ version: 2 });
    expect(
      (await put(bora, event.id, pollId, boraPhone.seal(pollOn(pollId)), 2, 'poll')).json(),
    ).toEqual({ version: 3 });

    // A vote: under the voter's own id for that poll, and only in a poll of this event.
    const loose = randomUuid();
    expect(
      (
        await put(can, event.id, loose, canPhone.seal(voteIn(loose, pollId)), null, {
          vote: pollId,
        })
      ).statusCode,
    ).toBe(400);
    for (const elsewhere of [event.id, other.id, randomUuid()]) {
      const id = voteId(elsewhere, can.userId);
      const stray = await put(can, event.id, id, canPhone.seal(voteIn(id, elsewhere)), null, {
        vote: elsewhere,
      });
      expect(stray.statusCode).toBe(404);
    }
    const canVote = voteId(pollId, can.userId);
    await put(can, event.id, canVote, canPhone.seal(voteIn(canVote, pollId)), null, {
      vote: pollId,
    });
    expect((await list(owner, event.id)).map((doc) => doc.id).sort()).toEqual(
      [pollId, canVote].sort(),
    );
    // A poll that goes takes its votes along.
    expect(
      (await as(test, bora, 'DELETE', `/v1/circles/${event.id}/docs/${pollId}`)).statusCode,
    ).toBe(204);
    expect(await list(owner, event.id)).toEqual([]);

    // Each member starts so many polls in one event.
    await test.admin.query(
      `INSERT INTO app.circle_docs (circle_id, id, author_id, shared, kind, envelope)
       SELECT $1, gen_random_uuid(), $2, true, 'poll', $3::jsonb FROM generate_series(1, $4::int)`,
      [event.id, bora.userId, JSON.stringify(boraPhone.seal(pollOn(pollId))), MAX_POLLS_PER_MEMBER],
    );
    const more = randomUuid();
    const tooMany = await put(bora, event.id, more, boraPhone.seal(pollOn(more)), null, 'poll');
    expect(tooMany.json()).toMatchObject({ code: 'DOCS_FULL' });
    expect(
      (await put(owner, event.id, more, ownerPhone.seal(pollOn(more)), null, 'poll')).statusCode,
    ).toBe(200);
  });
});
