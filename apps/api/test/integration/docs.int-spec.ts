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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { MeetingSweeper } from '../../src/docs/meeting-sweeper.js';
import { EventsService } from '../../src/events/events.service.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { REDIS, type RedisClient } from '../../src/infra/redis/redis.client.js';
import { Notifier } from '../../src/push/notifier.js';
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

    // A group holds only its meeting (docs/ADR/0026), which says when it goes: no polls there.
    const group = await circleWith(test, ayse, bora);
    const groupPhone = phone(ayse, group);
    const noEnd = await put(
      ayse,
      group.id,
      group.id,
      groupPhone.seal(meeting(group.id)),
      null,
      'plan',
    );
    expect(noEnd.statusCode).toBe(400);
    const poll = randomUuid();
    const polled = await put(ayse, group.id, poll, groupPhone.seal(pollOn(poll)), null, 'poll');
    expect(polled.statusCode).toBe(403);
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

/** A meeting outside an event, as the phones save it: with its end, and notices when it starts. */
const startOrChange = (
  who: Person,
  circle: Pick<Circle, 'id'>,
  envelope: MessageEnvelope,
  version: number | null,
  extra: { endsAt?: number; pushes?: unknown[] } = { endsAt: Date.now() + 4 * HOUR },
) =>
  as(test, who, 'PUT', `/v1/circles/${circle.id}/docs/${circle.id}`, {
    envelope,
    version,
    kind: 'plan',
    pollId: null,
    ...extra,
  });
const inCircle = (circleId: string, by: Person): DocPayload => ({
  kind: 'plan',
  id: circleId,
  meetAt: Date.UTC(2026, 9, 18, 16, 30),
  placeId: '0190f7a4-2222-7222-8222-000000000001',
  by: by.userId,
  ts: Date.now(),
});

describe('a meeting in any circle (docs/ADR/0026)', () => {
  it('is started by any member, one at a time, run by its starter and the admins only', async () => {
    const [ayse, bora, can, mallory] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    // Ayşe made the circle (its admin); Bora and Can are members.
    const family = await circleWith(test, ayse, bora, can);
    const boraPhone = phone(bora, family);
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    const started = await startOrChange(
      bora,
      family,
      boraPhone.seal(inCircle(family.id, bora)),
      null,
    );
    expect(started.json()).toEqual({ version: 1 });
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([ayse.userId, can.userId]), {
      type: 'docs.changed',
      circleId: family.id,
    });
    told.mockRestore();
    // Members read it (ciphertext only); someone outside sees nothing and touches nothing.
    expect(await list(can, family.id)).toHaveLength(1);
    expect(JSON.stringify(await list(can, family.id))).not.toContain('2026');
    expect(await list(mallory, family.id)).toEqual([]);
    const intruder = phone(mallory, family);
    expect(
      (await startOrChange(mallory, family, intruder.seal(inCircle(family.id, mallory)), 1))
        .statusCode,
    ).toBe(404);
    expect(
      (await as(test, mallory, 'DELETE', `/v1/circles/${family.id}/docs/${family.id}`)).statusCode,
    ).toBe(404);

    // One at a time: the others see it, and start none.
    const canPhone = phone(can, family);
    const second = await startOrChange(can, family, canPhone.seal(inCircle(family.id, can)), null);
    expect(second.json()).toMatchObject({ code: 'MEETING_EXISTS' });
    // Can neither started it nor runs the circle: no change, no end.
    const changed = await startOrChange(can, family, canPhone.seal(inCircle(family.id, bora)), 1);
    expect(changed.json()).toMatchObject({ code: 'FORBIDDEN' });
    const ended = await as(test, can, 'DELETE', `/v1/circles/${family.id}/docs/${family.id}`);
    expect(ended.json()).toMatchObject({ code: 'FORBIDDEN' });

    // Its starter changes it; the admin changes and ends it.
    expect(
      (await startOrChange(bora, family, boraPhone.seal(inCircle(family.id, bora)), 1)).json(),
    ).toEqual({ version: 2 });
    const aysePhone = phone(ayse, family);
    expect(
      (await startOrChange(ayse, family, aysePhone.seal(inCircle(family.id, bora)), 2)).json(),
    ).toEqual({ version: 3 });
    expect(
      (await as(test, ayse, 'DELETE', `/v1/circles/${family.id}/docs/${family.id}`)).statusCode,
    ).toBe(204);
    expect(await list(bora, family.id)).toEqual([]);
  });

  it('says when it goes: ahead, within a week; an event says no end', async () => {
    const [deniz, ece] = await Promise.all([person(test), person(test)]);
    const pair = await circleWith(test, deniz, ece);
    const denizPhone = phone(deniz, pair);
    for (const endsAt of [Date.now() - 1_000, Date.now() + 9 * 24 * HOUR]) {
      const bad = await startOrChange(
        deniz,
        pair,
        denizPhone.seal(inCircle(pair.id, deniz)),
        null,
        {
          endsAt,
        },
      );
      expect(bad.statusCode).toBe(400);
    }
    const event = await eventWith(deniz, ece);
    const withEnd = await as(test, deniz, 'PUT', `/v1/circles/${event.id}/docs/${event.id}`, {
      envelope: phone(deniz, event).seal(meeting(event.id)),
      version: null,
      kind: 'plan',
      pollId: null,
      endsAt: Date.now() + HOUR,
    });
    expect(withEnd.statusCode).toBe(400);
  });

  it('reaches only apps that can read it, and goes at its end with the worker', async () => {
    const [fuat, gul] = await Promise.all([person(test), person(test)]);
    const friends = await circleWith(test, fuat, gul);
    await startOrChange(fuat, friends, phone(fuat, friends).seal(inCircle(friends.id, fuat)), null);
    // An app before level 3 reads an event's documents only (ADR 0026 §7).
    const older = await call(test.app, {
      method: 'GET',
      url: `/v1/circles/${friends.id}/docs`,
      accessToken: gul.session.accessToken,
      clientLevel: 2,
    });
    expect(older.json()).toEqual({ docs: [] });
    expect(await list(gul, friends.id)).toHaveLength(1);

    // Past its end, the worker deletes it and tells the circle.
    await test.admin.query(
      `UPDATE app.circle_docs SET ends_at = now() - interval '1 second' WHERE circle_id = $1`,
      [friends.id],
    );
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    const sweeper = new MeetingSweeper(
      test.app.get(DatabaseService),
      test.app.get(EventsService),
      test.app.get<RedisClient>(REDIS),
    );
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    expect(told).toHaveBeenCalledWith(expect.arrayContaining([fuat.userId, gul.userId]), {
      type: 'docs.changed',
      circleId: friends.id,
    });
    told.mockRestore();
    expect(await list(gul, friends.id)).toEqual([]);
  });

  it("is either friend's to change and end in a friendship, whoever started it (ADR 0026 §1)", async () => {
    const [ece, fikret, mallory] = await Promise.all([person(test), person(test), person(test)]);
    const asked = await as(test, ece, 'POST', '/v1/friends', { username: fikret.username });
    const { id } = asked.json<Circle>();
    await as(test, fikret, 'POST', `/v1/circles/${id}/accept`);
    const pair = (await as(test, ece, 'GET', `/v1/circles/${id}`)).json<Circle>();
    expect(pair.kind).toBe('pair');
    // Ece made the friendship (its admin) and starts the meeting; Fikret changes and ends it.
    const started = await startOrChange(ece, pair, phone(ece, pair).seal(inCircle(id, ece)), null);
    expect(started.json()).toEqual({ version: 1 });
    const fikretPhone = phone(fikret, pair);
    const changed = await startOrChange(fikret, pair, fikretPhone.seal(inCircle(id, ece)), 1);
    expect(changed.json()).toEqual({ version: 2 });
    expect((await as(test, fikret, 'DELETE', `/v1/circles/${id}/docs/${id}`)).statusCode).toBe(204);
    // Still the two of them only: someone outside touches nothing.
    await startOrChange(fikret, pair, fikretPhone.seal(inCircle(id, fikret)), null);
    const intruder = phone(mallory, pair);
    expect(
      (await startOrChange(mallory, pair, intruder.seal(inCircle(id, mallory)), 1)).statusCode,
    ).toBe(404);
    expect((await as(test, mallory, 'DELETE', `/v1/circles/${id}/docs/${id}`)).statusCode).toBe(
      404,
    );
    expect(await list(fikret, id)).toHaveLength(1);
  });

  it('keeps its end only to the full hour (ADR 0026 §2, QA 22)', async () => {
    const [jale, kerem] = await Promise.all([person(test), person(test)]);
    const family = await circleWith(test, jale, kerem);
    // An end as an older app sends it, to the millisecond.
    const endsAt = Date.now() + 4 * HOUR + 17 * 60_000 + 321;
    const started = await startOrChange(
      jale,
      family,
      phone(jale, family).seal(inCircle(family.id, jale)),
      null,
      { endsAt },
    );
    expect(started.statusCode).toBe(200);
    const { rows } = await test.admin.query<{ ends_at: Date }>(
      'SELECT ends_at FROM app.circle_docs WHERE circle_id = $1 AND id = $1',
      [family.id],
    );
    const kept = rows[0]?.ends_at.getTime() ?? 0;
    expect(kept % HOUR).toBe(0);
    expect(kept).toBeGreaterThanOrEqual(endsAt);
    expect(kept - endsAt).toBeLessThan(HOUR);
  });

  it("goes with its starter's account, and the circle hears it (QA 21 B-3)", async () => {
    const [ayse, bora, can] = await Promise.all([person(test), person(test), person(test)]);
    const family = await circleWith(test, ayse, bora, can);
    await startOrChange(bora, family, phone(bora, family).seal(inCircle(family.id, bora)), null);
    expect(await list(can, family.id)).toHaveLength(1);
    const told = vi.spyOn(test.app.get(EventsService), 'publish');
    expect((await as(test, bora, 'POST', '/v1/me/delete', { confirm: true })).statusCode).toBe(204);
    // Bora's documents went with the account (the purge, here right away): the others hear it.
    expect(told).toHaveBeenCalledWith([ayse.userId, can.userId].sort(), {
      type: 'docs.changed',
      circleId: family.id,
    });
    told.mockRestore();
    expect(await list(can, family.id)).toEqual([]);
    // Nothing for an account that is not being deleted.
    const { rows } = await test.admin.query('SELECT * FROM app.doc_circles_of_deleted($1)', [
      ayse.userId,
    ]);
    expect(rows).toEqual([]);
  });

  it("hands the starter's sealed notices to the others' phones, once, when it starts", async () => {
    const [hale, ilker] = await Promise.all([person(test), person(test)]);
    const pair = await circleWith(test, hale, ilker);
    const forwarded = vi.spyOn(test.app.get(Notifier), 'forward');
    const pushes = [
      { userId: ilker.userId, deviceId: ilker.device.deviceId, sealed: 'A'.repeat(120) },
    ];
    const halePhone = phone(hale, pair);
    await startOrChange(hale, pair, halePhone.seal(inCircle(pair.id, hale)), null, {
      endsAt: Date.now() + 4 * HOUR,
      pushes,
    });
    // Ilker's app is not connected: the notice goes to their current phone.
    expect(forwarded).toHaveBeenCalledWith(
      pushes,
      new Map([[ilker.userId, ilker.device.deviceId]]),
    );
    // A change starts nothing; its own notices ("moved, still coming?", sealed by the phone for
    // those who answered, ADR 0026 Ek 2) go the same way.
    forwarded.mockClear();
    await startOrChange(hale, pair, halePhone.seal(inCircle(pair.id, hale)), 1, {
      endsAt: Date.now() + 4 * HOUR,
      pushes,
    });
    expect(forwarded).toHaveBeenCalledWith(
      pushes,
      new Map([[ilker.userId, ilker.device.deviceId]]),
    );
    forwarded.mockRestore();
  });
});

/** "Geliyorum" (0), "Belki" (1), "Gelemiyorum" (2) to a circle's meeting (docs/ADR/0026 Ek 2). */
const answerOf = (circleId: string, who: Person, choice: number): DocPayload => ({
  kind: 'vote',
  id: voteId(circleId, who.userId),
  pollId: circleId,
  choices: [choice],
  ts: Date.now(),
});
const answer = (
  who: Person,
  circleId: string,
  envelope: MessageEnvelope,
  version: number | null,
  extra: { endsAt?: number; pushes?: unknown[]; pollId?: string; docId?: string } = {},
) => {
  const { pollId = circleId, docId = voteId(circleId, who.userId), ...rest } = extra;
  return as(test, who, 'PUT', `/v1/circles/${circleId}/docs/${docId}`, {
    envelope,
    version,
    kind: 'vote',
    pollId,
    ...rest,
  });
};

describe('answers to a meeting outside an event (docs/ADR/0026 Ek 2)', () => {
  it("are any member's own, change in place, and go with the meeting", async () => {
    const [ayse, bora, can, mallory] = await Promise.all([
      person(test),
      person(test),
      person(test),
      person(test),
    ]);
    const family = await circleWith(test, ayse, bora, can);
    const canPhone = phone(can, family);
    // No meeting yet: nothing to answer.
    expect(
      (await answer(can, family.id, canPhone.seal(answerOf(family.id, can, 0)), null)).statusCode,
    ).toBe(404);

    const boraPhone = phone(bora, family);
    await startOrChange(bora, family, boraPhone.seal(inCircle(family.id, bora)), null);
    const going = await answer(can, family.id, canPhone.seal(answerOf(family.id, can, 0)), null);
    expect(going.json()).toEqual({ version: 1 });
    // A second answer the same way is "someone was faster"; changing it is in place.
    expect(
      (await answer(can, family.id, canPhone.seal(answerOf(family.id, can, 1)), null)).statusCode,
    ).toBe(409);
    expect(
      (await answer(can, family.id, canPhone.seal(answerOf(family.id, can, 1)), 1)).json(),
    ).toEqual({ version: 2 });
    // Ciphertext only, read by all members; nothing for someone outside.
    const docs = await list(ayse, family.id);
    expect(docs).toHaveLength(2);
    expect(await list(mallory, family.id)).toEqual([]);

    // Nobody answers for someone else, nor names an end, nor answers another document.
    const forCan = await answer(bora, family.id, boraPhone.seal(answerOf(family.id, can, 2)), 2, {
      docId: voteId(family.id, can.userId),
    });
    expect(forCan.statusCode).toBe(400);
    const withEnd = await answer(
      bora,
      family.id,
      boraPhone.seal(answerOf(family.id, bora, 0)),
      null,
      {
        endsAt: Date.now() + HOUR,
      },
    );
    expect(withEnd.statusCode).toBe(400);
    const elsewhere = randomUuid();
    const otherDoc = await answer(
      bora,
      family.id,
      boraPhone.seal(answerOf(family.id, bora, 0)),
      null,
      {
        pollId: elsewhere,
        docId: voteId(elsewhere, bora.userId),
      },
    );
    expect(otherDoc.statusCode).toBe(400);
    const intruder = phone(mallory, family);
    expect(
      (await answer(mallory, family.id, intruder.seal(answerOf(family.id, mallory, 0)), null))
        .statusCode,
    ).toBe(404);

    // Can takes it back (no starter, no admin: their own answer is theirs), answers again.
    const canAnswer = voteId(family.id, can.userId);
    expect(
      (await as(test, can, 'DELETE', `/v1/circles/${family.id}/docs/${canAnswer}`)).statusCode,
    ).toBe(204);
    expect(
      (await answer(can, family.id, canPhone.seal(answerOf(family.id, can, 0)), null)).statusCode,
    ).toBe(200);
    // The admin ends the meeting: the answers go with it (one foreign key, migration 0014).
    expect(
      (await as(test, ayse, 'DELETE', `/v1/circles/${family.id}/docs/${family.id}`)).statusCode,
    ).toBe(204);
    expect(await list(can, family.id)).toEqual([]);
    const { rows } = await test.admin.query('SELECT 1 FROM app.circle_docs WHERE circle_id = $1', [
      family.id,
    ]);
    expect(rows).toEqual([]);
  });

  it('go with a meeting the worker sweeps, and a new meeting starts with none', async () => {
    const [deniz, ece] = await Promise.all([person(test), person(test)]);
    const pair = await circleWith(test, deniz, ece);
    await startOrChange(deniz, pair, phone(deniz, pair).seal(inCircle(pair.id, deniz)), null);
    await answer(ece, pair.id, phone(ece, pair).seal(answerOf(pair.id, ece, 0)), null);
    expect(await list(deniz, pair.id)).toHaveLength(2);
    await test.admin.query(
      `UPDATE app.circle_docs SET ends_at = now() - interval '1 second' WHERE circle_id = $1 AND kind = 'plan'`,
      [pair.id],
    );
    const sweeper = new MeetingSweeper(
      test.app.get(DatabaseService),
      test.app.get(EventsService),
      test.app.get<RedisClient>(REDIS),
    );
    expect(await sweeper.sweep()).toBeGreaterThanOrEqual(1);
    expect(await list(ece, pair.id)).toEqual([]);
    // A new meeting is not taken for one that is still there.
    const again = await startOrChange(
      deniz,
      pair,
      phone(deniz, pair).seal(inCircle(pair.id, deniz)),
      null,
    );
    expect(again.statusCode).toBe(200);
  });

  it("hand an answer's sealed notice to the starter's phone when it is not connected", async () => {
    const [fuat, gul] = await Promise.all([person(test), person(test)]);
    const pair = await circleWith(test, fuat, gul);
    await startOrChange(fuat, pair, phone(fuat, pair).seal(inCircle(pair.id, fuat)), null);
    const forwarded = vi.spyOn(test.app.get(Notifier), 'forward');
    const pushes = [
      { userId: fuat.userId, deviceId: fuat.device.deviceId, sealed: 'B'.repeat(120) },
    ];
    await answer(gul, pair.id, phone(gul, pair).seal(answerOf(pair.id, gul, 0)), null, { pushes });
    expect(forwarded).toHaveBeenCalledWith(pushes, new Map([[fuat.userId, fuat.device.deviceId]]));
    forwarded.mockRestore();
  });
});
