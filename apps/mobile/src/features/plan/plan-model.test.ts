import type { LocPayload, PlanPayload, PollPayload, VotePayload } from '@bargu/schemas';

import {
  answerCounts,
  answersOf,
  approachRate,
  arrivalAt,
  arrivals,
  distanceTo,
  estimateArrival,
  type Doc,
  headcount,
  inEtaWindow,
  lateIsNews,
  lateMinutes,
  leaveReminderAt,
  MEETING,
  meetingEnd,
  meetingTimes,
  PROGRESS,
  starterOf,
  tally,
  travelMode,
  travelMs,
  withChoice,
  withProgress,
} from './plan-model';

const MIN = 60_000;
const ids = {
  circle: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  poll: '0190f7a4-2222-7222-8222-000000000009',
  ayse: '0190f7a4-1111-7111-8111-00000000a11c',
  bora: '0190f7a4-1111-7111-8111-000000000b0b',
  can: '0190f7a4-1111-7111-8111-0000000000ca',
  sahne: '0190f7a4-2222-7222-8222-000000000001',
  kafe: '0190f7a4-2222-7222-8222-000000000002',
};
const place = { lat: 41.0082, lng: 28.9784, radius: 100 };
/** A point `meters` north of the place's centre. */
const north = (meters: number) => ({ lat: place.lat + meters / 111_320, lng: place.lng });

describe('travel estimate', () => {
  it('walks short distances, rides long ones, and follows what the phone sees', () => {
    expect(travelMode(800, 'still')).toBe('walk');
    expect(travelMode(5_000, 'walking')).toBe('vehicle');
    expect(travelMode(800, 'driving')).toBe('vehicle');
    expect(travelMode(5_000, 'cycling')).toBe('bike');
    // 1 km on foot with the detour: 18 minutes.
    expect(travelMs(1_000, 'walk')).toBe(1_080_000);
  });

  it('is there at once inside the place, and later the farther away', () => {
    expect(arrivalAt(north(50), place, 1_000, 'still')).toBe(1_000);
    const left = distanceTo(north(1_100), place);
    expect(left).toBeCloseTo(1_000, -1);
    expect(arrivalAt(north(1_100), place, 0, 'walking')).toBe(travelMs(left, 'walk'));
    expect(arrivalAt(north(1_100), place, 0, 'walking', 'bike')).toBe(travelMs(left, 'bike'));
  });

  it('estimates only around the meeting', () => {
    const meetAt = 1_000 * MIN;
    expect(inEtaWindow(meetAt, meetAt - 91 * MIN)).toBe(false);
    expect(inEtaWindow(meetAt, meetAt - 90 * MIN)).toBe(true);
    expect(inEtaWindow(meetAt, meetAt + 30 * MIN)).toBe(true);
    expect(inEtaWindow(meetAt, meetAt + 31 * MIN)).toBe(false);
  });
});

describe('progress on the way', () => {
  /** Samples every half minute, getting closer at `rate` m/s from `start` metres. */
  const trip = (start: number, rate: number, minutes: number) =>
    Array.from({ length: minutes * 2 + 1 }, (_, i) => ({
      ts: i * 30_000,
      remaining: start - rate * i * 30,
    })).reduce<ReturnType<typeof withProgress>>((track, sample) => withProgress(track, sample), []);

  it('keeps one sample per half minute over the last ten minutes', () => {
    const track = trip(20_000, 8, 15);
    expect(track).toHaveLength(21);
    expect(track[0]?.ts).toBe(5 * MIN);
    // Ten seconds after the last one: nothing new is kept.
    expect(withProgress(track, { ts: 15 * MIN + 10_000, remaining: 1 }).at(-1)?.ts).toBe(15 * MIN);
  });

  it('trusts a trend only after a few minutes of getting closer', () => {
    expect(approachRate(trip(5_000, 6, 2))).toBeNull();
    expect(approachRate(trip(5_000, 6, 4))).toBeCloseTo(6);
    // Standing, or going the other way: no trend.
    expect(approachRate(trip(5_000, 0, 5))).toBeNull();
    expect(approachRate(trip(5_000, -3, 5))).toBeNull();
    expect(approachRate([])).toBeNull();
  });

  it('follows the trend, so traffic shows, within reason', () => {
    const now = 0;
    const typical = travelMs(6_000, 'vehicle');
    // Crawling at 3 m/s in traffic: later than a typical drive.
    expect(estimateArrival({ now, remaining: 6_000, activity: 'driving', rate: 3 })).toBe(
      2_000_000,
    );
    // A wild trend is held between half and three times the typical estimate.
    expect(estimateArrival({ now, remaining: 2_500, activity: 'driving', rate: 0.8 })).toBe(
      travelMs(2_500, 'vehicle') * PROGRESS.clamp.max,
    );
    expect(estimateArrival({ now, remaining: 6_000, activity: 'driving', rate: 30 })).toBe(
      Math.round(typical * PROGRESS.clamp.min),
    );
    // Walking pace far away: on the way to a stop or a car; the typical estimate stands.
    expect(estimateArrival({ now, remaining: 6_000, activity: 'walking', rate: 1.2 })).toBe(
      typical,
    );
    // Walking pace nearby: they walk all the way.
    expect(estimateArrival({ now, remaining: 1_200, activity: 'walking', rate: 1 })).toBe(
      1_200_000,
    );
    expect(estimateArrival({ now: 5, remaining: 0, activity: 'still' })).toBe(5);
  });
});

describe('lateness', () => {
  it('counts from ten minutes, in steps of five', () => {
    const meetAt = 1_000 * MIN;
    expect(lateMinutes(meetAt + 9 * MIN, meetAt)).toBe(0);
    expect(lateMinutes(meetAt + 10 * MIN, meetAt)).toBe(10);
    expect(lateMinutes(meetAt + 11 * MIN, meetAt)).toBe(15);
    expect(lateMinutes(meetAt + 2_000 * MIN, meetAt)).toBe(600);
  });

  it('is told once, and again only when it grows by ten minutes', () => {
    expect(lateIsNews(0, undefined)).toBe(false);
    expect(lateIsNews(10, undefined)).toBe(true);
    expect(lateIsNews(15, 10)).toBe(false);
    expect(lateIsNews(20, 10)).toBe(true);
  });
});

describe('the reminder to leave', () => {
  it('comes a quarter of an hour before the time to leave, which keeps a few minutes spare', () => {
    const meetAt = 1_000 * MIN;
    const left = distanceTo(north(1_100), place);
    const leaveAt = meetAt - MEETING.bufferMs - travelMs(left, 'walk');
    expect(leaveReminderAt(north(1_100), place, meetAt)).toEqual({
      leaveAt,
      remindAt: leaveAt - 15 * MIN,
    });
    expect(leaveReminderAt(north(1_100), place, meetAt, 'vehicle')?.leaveAt).toBe(
      meetAt - MEETING.bufferMs - travelMs(left, 'vehicle'),
    );
  });

  it('is not needed nearby', () => {
    expect(leaveReminderAt(north(350), place, 1_000 * MIN)).toBeNull();
  });
});

const poll: PollPayload = {
  kind: 'poll',
  id: ids.poll,
  by: ids.ayse,
  about: 'place',
  options: [
    { placeId: ids.sahne, name: 'Sahne' },
    { placeId: ids.kafe, name: 'Kafe' },
  ],
  ts: 1,
};
const vote = (
  authorId: string,
  choices: number[],
  ts = 1,
  pollId = ids.poll,
): Doc<VotePayload> => ({
  circleId: ids.circle,
  version: 1,
  shared: false,
  authorId,
  payload: { kind: 'vote', id: ids.poll, pollId, choices, ts },
});

describe('polls', () => {
  const members = new Set([ids.ayse, ids.bora, ids.can]);

  it("counts each member's latest vote once, and leads with the most votes", () => {
    const result = tally(
      poll,
      [
        vote(ids.ayse, [0, 1]),
        vote(ids.bora, [0], 1),
        vote(ids.bora, [1], 2),
        vote(ids.can, [1, 1]),
      ],
      members,
    );
    expect(result).toEqual({
      counts: [1, 3],
      voters: [[ids.ayse], [ids.ayse, ids.bora, ids.can]],
      leader: 1,
    });
  });

  it('ignores votes of others than members, of other polls, and for options that do not exist', () => {
    const result = tally(
      poll,
      [
        vote('0190f7a4-1111-7111-8111-0000000000ff', [0]),
        vote(ids.ayse, [0], 1, ids.circle),
        vote(ids.bora, [3]),
      ],
      members,
    );
    expect(result).toEqual({ counts: [0, 0], voters: [[], []], leader: null });
    // A tie goes to the first option.
    expect(tally(poll, [vote(ids.ayse, [0]), vote(ids.bora, [1])], members).leader).toBe(0);
  });

  it("puts the choice into the meeting: a time poll's time, a place poll's place", () => {
    const plan: PlanPayload = { kind: 'plan', id: ids.circle, ts: 1 };
    expect(withChoice(plan, poll, 1)).toEqual({ ...plan, placeId: ids.kafe });
    const times: PollPayload = { ...poll, about: 'time', options: [{ at: 5 }, { at: 9 }] };
    expect(withChoice(plan, times, 0)).toEqual({ ...plan, meetAt: 5 });
    expect(withChoice(plan, times, 3)).toBe(plan);
  });
});

describe('who is there when', () => {
  const meetAt = 1_000 * MIN;
  const now = meetAt - 20 * MIN;
  const loc = (at: { lat: number; lng: number }, extra: Partial<LocPayload> = {}): LocPayload => ({
    kind: 'loc',
    ...at,
    acc: 10,
    bat: 80,
    chg: false,
    ts: now - MIN,
    ...extra,
  });

  it('shows who is there, who comes when (late or not), and whom nobody knows about', () => {
    const rows = arrivals({
      meetAt,
      place,
      members: [ids.ayse, ids.bora, ids.can, 'dana', 'emre', 'fatma'],
      locations: {
        [ids.ayse]: loc(north(2_000), { eta: { meetAt, at: meetAt + 25 * MIN } }),
        [ids.bora]: loc(north(20)),
        [ids.can]: loc(north(800), { eta: { meetAt, at: meetAt - 5 * MIN } }),
        // An estimate for another meeting time, and an old location.
        dana: loc(north(800), { eta: { meetAt: meetAt + MIN, at: meetAt } }),
        emre: loc(north(800), { ts: now - 16 * MIN }),
      },
      now,
    });
    expect(rows).toEqual([
      { userId: ids.bora, state: 'there', by: 'location' },
      { userId: ids.can, state: 'coming', at: meetAt - 5 * MIN, late: 0, estimated: true },
      { userId: ids.ayse, state: 'coming', at: meetAt + 25 * MIN, late: 25, estimated: true },
      { userId: 'dana', state: 'unknown' },
      { userId: 'emre', state: 'unknown' },
      { userId: 'fatma', state: 'unknown' },
    ]);
  });

  it('takes no location dated ahead (a wrong clock, QA-42)', () => {
    const rows = arrivals({
      meetAt,
      place,
      members: [ids.ayse],
      locations: {
        [ids.ayse]: loc(north(800), { eta: { meetAt, at: meetAt + 5 * MIN }, ts: now + 10 * MIN }),
      },
      now,
    });
    expect(rows).toEqual([{ userId: ids.ayse, state: 'unknown' }]);
  });

  it('shows no estimate for someone standing still, only their own word (Ö12)', () => {
    const eta = { eta: { meetAt, at: meetAt + 5 * MIN } };
    const rows = arrivals({
      meetAt,
      place,
      members: [ids.ayse, ids.bora, ids.can, 'dana'],
      locations: {
        // Walking: on the way.
        [ids.ayse]: loc(north(800), { ...eta, spd: 1.4 }),
        // Speed near nothing, or staying for minutes: not on the way.
        [ids.bora]: loc(north(800), { ...eta, spd: 0.2 }),
        [ids.can]: loc(north(800), { ...eta, since: now - 10 * MIN }),
        // Still, but said they would be late: their word.
        dana: loc(north(800), { ...eta, spd: 0 }),
      },
      told: { dana: 20 },
      now,
    });
    expect(rows.map((row) => [row.userId, row.state])).toEqual([
      [ids.ayse, 'coming'],
      ['dana', 'coming'],
      [ids.bora, 'still'],
      [ids.can, 'still'],
    ]);
  });

  it('outside an event, shows only who said "Geliyorum", its starter and who said "Geldim" (QA-35)', () => {
    const coming = { eta: { meetAt, at: meetAt + 10 * MIN } };
    const rows = arrivals({
      meetAt,
      place,
      members: [ids.ayse, ids.bora, ids.can, 'dana', 'emre', 'fatma'],
      locations: {
        [ids.ayse]: loc(north(2_000), coming),
        // "Belki" and "Gelemiyorum", sharing their location with an estimate: not coming.
        [ids.bora]: loc(north(2_000), coming),
        [ids.can]: loc(north(2_000), coming),
        // No answer: neither.
        dana: loc(north(2_000), coming),
        // The starter, who said nothing: coming.
        emre: loc(north(2_000), coming),
      },
      arrived: new Set(['fatma']),
      answers: new Map([
        [ids.ayse, 'going'],
        [ids.bora, 'maybe'],
        [ids.can, 'not'],
        ['fatma', 'maybe'],
      ]),
      starter: 'emre',
      now,
    });
    expect(rows.map((row) => [row.userId, row.state])).toEqual([
      ['fatma', 'there'],
      [ids.ayse, 'coming'],
      ['emre', 'coming'],
    ]);
    // The starter who said they cannot come is not on it either.
    expect(
      arrivals({
        meetAt,
        place,
        members: ['emre'],
        locations: { emre: loc(north(2_000), coming) },
        answers: new Map([['emre', 'not']]),
        starter: 'emre',
        now,
      }),
    ).toEqual([]);
  });

  it("takes people's own word when it says later than their phone", () => {
    const rows = arrivals({
      meetAt,
      place,
      members: [ids.ayse, ids.bora, ids.can],
      locations: {
        [ids.ayse]: loc(north(2_000), { eta: { meetAt, at: meetAt - 2 * MIN } }),
        [ids.bora]: loc(north(20)),
      },
      told: { [ids.ayse]: 20, [ids.bora]: 30, [ids.can]: 15 },
      now,
    });
    expect(rows).toEqual([
      // There already: whatever they said.
      { userId: ids.bora, state: 'there', by: 'location' },
      { userId: ids.can, state: 'coming', at: meetAt + 15 * MIN, late: 15, estimated: false },
      { userId: ids.ayse, state: 'coming', at: meetAt + 20 * MIN, late: 20, estimated: true },
    ]);
  });

  it('never tells an arrival from a coarse location, only from an exact one or their word (ADR 0026 §5)', () => {
    const rows = arrivals({
      meetAt,
      place,
      members: [ids.ayse, ids.bora, ids.can],
      locations: {
        // Neighbourhood precision: a cell's centre right inside the place, ~708 m accuracy.
        [ids.ayse]: loc(north(20), { acc: 708 }),
        [ids.bora]: loc(north(20), { acc: MEETING.arrivalAccuracyM }),
      },
      arrived: new Set([ids.can]),
      now,
    });
    // A coarse location with an estimate (an older or changed phone): not on the way (QA 22).
    expect(
      arrivals({
        meetAt,
        place,
        members: [ids.ayse],
        locations: { [ids.ayse]: loc(north(2_000), { acc: 708, eta: { meetAt, at: meetAt } }) },
        now,
      }),
    ).toEqual([{ userId: ids.ayse, state: 'unknown' }]);
    expect(rows).toEqual([
      { userId: ids.bora, state: 'there', by: 'location' },
      { userId: ids.can, state: 'there', by: 'word' },
      { userId: ids.ayse, state: 'unknown' },
    ]);
  });
});

describe('a meeting outside an event on the server', () => {
  it('goes at its time plus 3 hours, up to the next full hour (ADR 0026 §2, QA 22)', () => {
    const hour = 60 * MIN;
    expect(meetingEnd({ meetAt: 10 * hour })).toBe(10 * hour + MEETING.keptMs);
    expect(meetingEnd({ meetAt: 10 * hour + 17 * MIN })).toBe(11 * hour + MEETING.keptMs);
    expect(meetingEnd({})).toBeNull();
  });
});

describe('a meeting at a glance (docs/ADR/0026 §8)', () => {
  it('counts the way only from estimates, and celebrates only exact arrivals', () => {
    expect(
      headcount([
        { userId: 'a', state: 'there', by: 'location' },
        { userId: 'b', state: 'coming', at: 1, late: 0, estimated: true },
        // A coarse sharer (or a ghost) who said "late": in the total, not on the way.
        { userId: 'c', state: 'coming', at: 1, late: 10, estimated: false },
        { userId: 'd', state: 'unknown' },
      ]),
    ).toEqual({ there: 1, coming: 1, total: 4, allThereExactly: false });
    const exact = { userId: 'a', state: 'there', by: 'location' } as const;
    expect(headcount([exact, { ...exact, userId: 'b' }]).allThereExactly).toBe(true);
    // All there, one only by their word: no effect.
    expect(headcount([exact, { userId: 'b', state: 'there', by: 'word' }])).toEqual({
      there: 2,
      coming: 0,
      total: 2,
      allThereExactly: false,
    });
    // Alone is no meeting.
    expect(headcount([exact]).allThereExactly).toBe(false);
  });
});

describe('meeting times', () => {
  it('are quarter hours from a quarter of an hour ahead to the end of the event', () => {
    // 16:00 is a quarter hour; at 16:07 the first time offered is 16:30.
    const four = 960 * MIN;
    const now = four + 7 * MIN;
    expect(meetingTimes(now, four + 60 * MIN)).toEqual([
      four + 30 * MIN,
      four + 45 * MIN,
      four + 60 * MIN,
    ]);
    expect(meetingTimes(now, now)).toEqual([]);
  });
});

describe('answers to a meeting (docs/ADR/0026 Ek 2)', () => {
  const circleId = '0190f7a4-1111-7111-8111-0000000000c1';
  const pollId = '0190f7a4-1111-7111-8111-0000000000d1';
  const vote = (authorId: string, choice: number, poll = circleId): Doc => ({
    circleId,
    version: 1,
    shared: false,
    authorId,
    payload: { kind: 'vote', id: `${authorId}-${poll}`, pollId: poll, choices: [choice], ts: 1 },
  });

  it("read each member's answer from votes on the meeting, never a poll's votes", () => {
    const all = {
      a: vote('ayse', 0),
      b: vote('bora', 1),
      c: vote('can', 2),
      d: vote('deniz', 0, pollId),
      e: vote('ece', 7),
    };
    const answers = answersOf(all, circleId);
    expect([...answers]).toEqual([
      ['ayse', 'going'],
      ['bora', 'maybe'],
      ['can', 'not'],
    ]);
    expect(answerCounts(answers)).toEqual({ going: 1, maybe: 1, not: 1 });
    expect(answersOf(all, '0190f7a4-1111-7111-8111-0000000000c2').size).toBe(0);
  });
});

describe("a meeting's starter (QA-35)", () => {
  const plan = (version: number, authorId: string): Doc => ({
    circleId: 'c1',
    version,
    shared: true,
    authorId,
    payload: { kind: 'plan', id: 'c1', meetAt: 1, by: 'ayse', ts: 1 },
  });

  it('is whoever signed its first version; a first version naming someone else names nobody', () => {
    expect(starterOf(plan(1, 'ayse'))).toBe('ayse');
    expect(starterOf(plan(1, 'bora'))).toBeUndefined();
    // Changed later by an admin (only the starter and admins may): the name stays.
    expect(starterOf(plan(2, 'bora'))).toBe('ayse');
    expect(starterOf(undefined)).toBeUndefined();
  });
});
