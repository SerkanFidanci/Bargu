import { randomUuid, voteId } from '@bargu/crypto';
import type { Circle, DocRecord, MessageEnvelope, PollPayload, VotePayload } from '@bargu/schemas';

import { circleOf, exchangeKeys, type Person, somebody } from '../location/test-support';
import { createDocs, type DocExtra, type DocRefusal, docKey, type DocsApi, useDocs } from './docs';
import { type Doc, MEETING } from './plan-model';

class Refused extends Error {
  constructor(readonly code: Exclude<DocRefusal, null>) {
    super(code);
  }
}

/** The server as phones see it: compare-and-set, current epoch, others' votes untouchable. */
function fakeServer(epochOf: (circleId: string) => number) {
  const rows = new Map<string, DocRecord>();
  /** What each save sent along (a meeting outside an event: its end, its notices). */
  const extras = new Map<string, DocExtra>();
  const api: DocsApi = {
    list: (circleId) =>
      Promise.resolve([...rows.values()].filter((row) => row.circleId === circleId)),
    put: (circleId, docId, envelope: MessageEnvelope, version, kind, _pollId, extra = {}) => {
      extras.set(docId, extra);
      const shared = kind !== 'vote';
      if (envelope.epoch !== epochOf(circleId)) return Promise.reject(new Refused('EPOCH_STALE'));
      const row = rows.get(docId);
      const ownedByAnother =
        row !== undefined && !row.shared && row.envelope.senderDeviceId !== envelope.senderDeviceId;
      if ((row?.version ?? null) !== version || ownedByAnother || (row && row.shared !== shared)) {
        return Promise.reject(new Refused('VERSION_CONFLICT'));
      }
      const next = { circleId, id: docId, version: (version ?? 0) + 1, shared, envelope };
      rows.set(docId, next);
      return Promise.resolve(next.version);
    },
    remove: (_circleId, docId) => {
      rows.delete(docId);
      return Promise.resolve();
    },
  };
  return { api, rows, extras };
}

function docsOf(
  person: Person,
  circles: () => Circle[],
  api: DocsApi,
  now = 1_000,
  onMeetingStarted?: (circle: Circle, doc: Doc) => void,
) {
  return createDocs({
    api,
    keys: () => person.keys,
    device: () => person.device,
    userId: () => person.userId,
    circles,
    store: () => person.store,
    refusal: (error) => (error instanceof Refused ? error.code : null),
    refreshCircle: () => Promise.resolve(null),
    ...(onMeetingStarted === undefined ? {} : { onMeetingStarted }),
    now: () => now,
  });
}

const HOUR = 3_600_000;
const event = (people: Person[], overrides: Partial<Circle> = {}) =>
  circleOf(people, { kind: 'event', startedAt: 0, expiresAt: 5 * HOUR, ...overrides });

const pollFor = (id: string, by: string): PollPayload => ({
  kind: 'poll',
  id,
  by,
  about: 'place',
  options: [
    { placeId: randomUuid(), name: 'Moda Sahili' },
    { placeId: randomUuid(), name: 'Kafe' },
  ],
  ts: 0,
});

beforeEach(() => {
  useDocs.setState({}, true);
});

describe('event documents on the phone', () => {
  it("are sealed on the author's phone and opened on the others'", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = event([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const plan = { kind: 'plan', id: circle.id, meetAt: 2 * HOUR, ts: 0 } as const;

    expect(await docsOf(ayse, () => [circle], server.api).save(circle.id, plan)).toBe('saved');
    const pollId = randomUuid();
    await docsOf(ayse, () => [circle], server.api).save(circle.id, pollFor(pollId, ayse.userId));
    expect(JSON.stringify([...server.rows.values()])).not.toContain('Moda');

    useDocs.setState({}, true);
    await docsOf(bora, () => [circle], server.api).sync();
    expect(useDocs.getState()[docKey(circle.id, circle.id)]).toEqual({
      circleId: circle.id,
      version: 1,
      shared: true,
      authorId: ayse.userId,
      payload: { ...plan, ts: 1_000 },
    });
    expect(useDocs.getState()[docKey(circle.id, pollId)]?.payload).toMatchObject({
      kind: 'poll',
      by: ayse.userId,
    });
  });

  it("file each member's vote under them: a vote under someone else's name is not counted", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = event([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const pollId = randomUuid();
    const boras = docsOf(bora, () => [circle], server.api);
    await boras.save(circle.id, pollFor(pollId, bora.userId));
    const own = voteId(pollId, bora.userId);
    expect(
      await boras.save(circle.id, { kind: 'vote', id: own, pollId, choices: [1], ts: 0 }),
    ).toBe('saved');
    // Bora files a second vote under Ayşe's id: it opens, but it is not hers.
    const forged = voteId(pollId, ayse.userId);
    await boras.save(circle.id, { kind: 'vote', id: forged, pollId, choices: [0], ts: 0 });

    useDocs.setState({}, true);
    await docsOf(ayse, () => [circle], server.api).sync();
    const votes = Object.values(useDocs.getState()).filter((doc) => doc.payload.kind === 'vote');
    expect(votes.map((doc) => [doc.authorId, doc.shared, doc.payload.id])).toEqual([
      [bora.userId, false, own],
    ]);
  });

  it('are sealed again under a new epoch: shared ones by an admin, votes by their voter', async () => {
    const [ayse, bora, cem] = [somebody(), somebody(), somebody()];
    let circle = event([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const ayses = docsOf(ayse, () => [circle], server.api);
    await ayses.save(circle.id, { kind: 'plan', id: circle.id, meetAt: 2 * HOUR, ts: 0 });
    const pollId = randomUuid();
    await ayses.save(circle.id, pollFor(pollId, ayse.userId));
    const vote = voteId(pollId, ayse.userId);
    await ayses.save(circle.id, { kind: 'vote', id: vote, pollId, choices: [0], ts: 0 });

    // Cem joins: a new epoch, keys of that epoch only for him.
    circle = { ...event([ayse, bora, cem]), id: circle.id, epoch: 2 };
    exchangeKeys(circle, [ayse, bora, cem]);
    useDocs.setState({}, true);
    // A member seals none of them again (the meeting and polls are the admins', docs/ADR/0020).
    expect(await docsOf(bora, () => [circle], server.api).sync()).toEqual([]);
    useDocs.setState({}, true);
    const boras = docsOf(bora, () => [{ ...circle, myRole: 'owner' }], server.api);
    const stale = await boras.sync();
    // Bora, an admin, may seal the meeting and the poll again, not Ayşe's vote.
    expect(stale.map((doc) => doc.id).sort()).toEqual([circle.id, pollId].sort());
    expect(await boras.reseal(stale)).toBe(2);

    useDocs.setState({}, true);
    const ayseStale = await docsOf(ayse, () => [circle], server.api).sync();
    expect(ayseStale.map((doc) => doc.id)).toEqual([vote]);
    await docsOf(ayse, () => [circle], server.api).reseal(ayseStale);

    useDocs.setState({}, true);
    await docsOf(cem, () => [circle], server.api).sync();
    expect(
      Object.values(useDocs.getState())
        .map((doc) => doc.payload.kind)
        .sort(),
    ).toEqual(['plan', 'poll', 'vote']);
  });

  it("drop this member's votes whose poll is gone, and never bring back a deleted poll", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = event([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const pollId = randomUuid();
    const ayses = docsOf(ayse, () => [circle], server.api);
    await ayses.save(circle.id, pollFor(pollId, ayse.userId));
    const old = server.rows.get(pollId);
    const boras = docsOf(bora, () => [circle], server.api);
    await boras.sync();
    const vote = voteId(pollId, bora.userId);
    await boras.save(circle.id, { kind: 'vote', id: vote, pollId, choices: [1], ts: 0 });

    expect(await ayses.remove(circle.id, pollId)).toBe(true);
    await boras.sync();
    expect(server.rows.has(vote)).toBe(false);

    // The server serves the deleted poll again: Ayşe's phone does not take it back.
    if (old !== undefined) server.rows.set(pollId, old);
    await ayses.sync();
    expect(useDocs.getState()[docKey(circle.id, pollId)]).toBeUndefined();
  });

  it("say when only a poll's starter or an admin may change it, and send each kind as such (Faz 9 O4)", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = event([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const server = fakeServer(() => circle.epoch);
    const sent: [string, string | null][] = [];
    const pollId = randomUuid();
    const api: DocsApi = {
      ...server.api,
      put: (circleId, docId, envelope, version, kind, poll) => {
        sent.push([kind, poll]);
        if (kind === 'poll' && version !== null) return Promise.reject(new Refused('FORBIDDEN'));
        return server.api.put(circleId, docId, envelope, version, kind, poll);
      },
    };
    const boras = docsOf(bora, () => [circle], api);
    await boras.save(circle.id, pollFor(pollId, ayse.userId));
    const vote: VotePayload = {
      kind: 'vote',
      id: voteId(pollId, bora.userId),
      pollId,
      choices: [0],
      ts: 0,
    };
    await boras.save(circle.id, vote);
    const closing = { ...pollFor(pollId, ayse.userId), closed: { choice: 0 } };
    expect(await boras.save(circle.id, closing)).toBe('forbidden');
    expect(sent).toEqual([
      ['poll', null],
      ['vote', pollId],
      ['poll', null],
    ]);
  });

  it('hold a meeting in any circle, with its end; polls only in events (docs/ADR/0026)', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const group = circleOf([ayse, bora]);
    const circle = event([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    exchangeKeys(group, [ayse, bora]);
    const server = fakeServer((id) => (id === group.id ? group.epoch : circle.epoch));
    const ayses = docsOf(ayse, () => [group, circle], server.api);
    // Outside an event: no meeting without its time (it goes 3 hours after), and no polls.
    expect(await ayses.save(group.id, { kind: 'plan', id: group.id, ts: 0 })).toBe('failed');
    expect(await ayses.save(group.id, pollFor(randomUuid(), ayse.userId))).toBe('forbidden');
    const meeting = {
      kind: 'plan',
      id: group.id,
      meetAt: 2 * HOUR,
      by: ayse.userId,
      ts: 0,
    } as const;
    expect(await ayses.save(group.id, meeting, { pushes: [] })).toBe('saved');
    expect(server.extras.get(group.id)).toEqual({ endsAt: 2 * HOUR + MEETING.keptMs, pushes: [] });
    // A change says its end again; notices go only when it starts.
    await ayses.save(group.id, { ...meeting, meetAt: 3 * HOUR }, { pushes: [] });
    expect(server.extras.get(group.id)).toEqual({ endsAt: 3 * HOUR + MEETING.keptMs });
    // An event's meeting says no end: it goes with the event.
    await ayses.save(circle.id, { kind: 'plan', id: circle.id, meetAt: 2 * HOUR, ts: 0 });
    expect(server.extras.get(circle.id)).toEqual({});
    expect(Object.keys(useDocs.getState())).toHaveLength(2);

    // The event ends (gone from the circles): its documents go from the phone; the group's stay.
    const after = docsOf(ayse, () => [group], server.api);
    after.prune();
    expect(Object.keys(useDocs.getState())).toEqual([docKey(group.id, group.id)]);
  });

  it('tell when someone else starts a meeting, and let its starter seal it again', async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const group = circleOf([ayse, bora]);
    exchangeKeys(group, [ayse, bora]);
    let epoch = group.epoch;
    const server = fakeServer(() => epoch);
    const started = jest.fn<undefined, [Circle, Doc]>();
    const ayses = docsOf(ayse, () => [group], server.api, 1_000, started);
    // A first look in this run: nothing there is "just started".
    await ayses.sync();
    const boras = docsOf(bora, () => [group], server.api);
    await boras.save(group.id, {
      kind: 'plan',
      id: group.id,
      meetAt: 2 * HOUR,
      by: bora.userId,
      ts: 0,
    });
    // One store per phone in the app; here both share it: back to Ayşe's view before Ayşe syncs.
    useDocs.setState({}, true);
    await ayses.sync();
    expect(started).toHaveBeenCalledTimes(1);
    expect(started.mock.calls[0]?.[1]).toMatchObject({ payload: { by: bora.userId } });
    await ayses.sync();
    expect(started).toHaveBeenCalledTimes(1);

    // A new epoch: Bora, its starter (no admin), seals it again, and says its end.
    const next = { ...group, epoch: 2 };
    epoch = 2;
    exchangeKeys(next, [ayse, bora]);
    const borasNext = docsOf(bora, () => [next], server.api);
    const stale = await borasNext.sync();
    expect(stale).toHaveLength(1);
    expect(await borasNext.reseal(stale)).toBe(1);
    expect(server.extras.get(group.id)).toEqual({ endsAt: 2 * HOUR + MEETING.keptMs });
  });

  it("let either friend seal a friendship's meeting again, whoever started it (ADR 0026 §1)", async () => {
    const [ayse, bora] = [somebody(), somebody()];
    const pair = circleOf([ayse, bora], { kind: 'pair', name: null });
    exchangeKeys(pair, [ayse, bora]);
    let epoch = pair.epoch;
    const server = fakeServer(() => epoch);
    const meeting = {
      kind: 'plan',
      id: pair.id,
      meetAt: 2 * HOUR,
      by: bora.userId,
      ts: 0,
    } as const;
    await docsOf(bora, () => [pair], server.api).save(pair.id, meeting, { pushes: [] });
    // A new epoch: Ayşe, who neither started it nor is an admin, seals it again.
    const next = { ...pair, epoch: 2 };
    epoch = 2;
    exchangeKeys(next, [ayse, bora]);
    useDocs.setState({}, true);
    const aysesNext = docsOf(ayse, () => [next], server.api);
    const stale = await aysesNext.sync();
    expect(stale).toHaveLength(1);
    expect(await aysesNext.reseal(stale)).toBe(1);
  });
});
