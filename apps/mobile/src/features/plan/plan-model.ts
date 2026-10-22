import type { DocPayload, LocPayload, PlanPayload, PollPayload, VotePayload } from '@bargu/schemas';

import { distanceM } from '../location/send';
import type { Activity } from '../map/activity';

/**
 * A document of an event as this phone holds it (docs/ADR/0018): opened, checked, and the
 * server's version to change it from. `authorId` is the member whose device signed it: for a vote,
 * the voter; for a shared document, whoever saved it last.
 */
export interface Doc<P extends DocPayload = DocPayload> {
  circleId: string;
  version: number;
  shared: boolean;
  authorId: string;
  payload: P;
}

/** Timings of an event's meeting (docs/ADR/0018). */
export const MEETING = {
  /** From this long before the meeting, phones estimate when they will be there… */
  etaFromMs: 90 * 60_000,
  /** …until this long after it. */
  etaUntilMs: 30 * 60_000,
  /** Expected later than this past the meeting time: the others hear "will be late"… */
  lateAfterMin: 10,
  /** …once the estimate has said so for this long (a short detour or stop is not news). */
  lateHoldMs: 3 * 60_000,
  /** …and again only when it grows by this much. */
  lateStepMin: 10,
  /**
   * A "will be late" that did not get through is tried again after this long, twice as long after
   * each failure, not with every new position (QA Faz 8 D10)…
   */
  lateRetryMs: 60_000,
  /** …at most this long apart (the server takes 20 in 10 minutes). */
  lateRetryMaxMs: 10 * 60_000,
  /** Lateness is told in steps of this many minutes ("about 15 min"). */
  lateRoundMin: 5,
  /** The reminder to leave comes this long before the time to leave. */
  leaveNoticeMs: 15 * 60_000,
  /** Arrive this early: a few minutes to find each other. */
  bufferMs: 5 * 60_000,
  /** Closer than this needs no reminder to leave. */
  nearM: 300,
  /** The time steps the meeting time is picked in. */
  stepMs: 15 * 60_000,
  /**
   * A meeting outside an event goes this long after its time (docs/ADR/0026 §2): the server
   * deletes it then; "Bitir" ends it at once.
   */
  keptMs: 3 * 3600_000,
  /** Outside an event a meeting is set at most this far ahead (the server allows a day more). */
  aheadMs: 7 * 24 * 3600_000,
  /**
   * "There" from a location only when it is this exact (metres, docs/ADR/0026 §5): a coarse one is
   * a cell's centre, which may fall inside the place, and must never tell an arrival.
   */
  arrivalAccuracyM: 100,
} as const;

const HOUR_MS = 3600_000;

/**
 * When the server deletes a meeting outside an event: its time plus MEETING.keptMs, up to the next
 * full hour, so the server learns its time within an hour only (docs/ADR/0026 §2, QA 22). The
 * phone itself drops it at its time plus MEETING.keptMs. Null without a time.
 */
export function meetingEnd(plan: Pick<PlanPayload, 'meetAt'>): number | null {
  if (plan.meetAt === undefined) return null;
  return Math.ceil((plan.meetAt + MEETING.keptMs) / HOUR_MS) * HOUR_MS;
}

/**
 * A rough door-to-door estimate without any routing service (nothing about the trip leaves the
 * phone): the straight line times a detour factor, at a typical average speed for the way of
 * travelling, stops and traffic included.
 */
const TRAVEL = {
  detour: 1.35,
  /** Metres per second: about 4.5, 14 and 23 km/h. */
  speeds: { walk: 1.25, bike: 4, vehicle: 6.5 },
  /** Farther than this is not walked unless the phone says so. */
  walkUpToM: 2_000,
} as const;
export type TravelMode = keyof typeof TRAVEL.speeds;

interface Point {
  lat: number;
  lng: number;
}
interface Area extends Point {
  radius: number;
}

/** How someone is likely to get there: what they are doing now, else by the distance. */
export function travelMode(distance: number, activity: Activity): TravelMode {
  if (activity === 'driving') return 'vehicle';
  if (activity === 'cycling') return 'bike';
  return distance <= TRAVEL.walkUpToM ? 'walk' : 'vehicle';
}

/** Milliseconds to cover `distance` metres (straight line) this way. */
export function travelMs(distance: number, mode: TravelMode): number {
  return Math.round(((distance * TRAVEL.detour) / TRAVEL.speeds[mode]) * 1000);
}

/** Metres still to go to the edge of the place (0: there). */
export function distanceTo(from: Point, place: Area): number {
  return Math.max(0, distanceM(from, place) - place.radius);
}

/** Metres still to go to the meeting place at a moment: the phone keeps the last few minutes. */
export interface Progress {
  ts: number;
  remaining: number;
}

/**
 * How someone actually gets closer, which no typical speed knows: a car in traffic, a bus, a
 * detour. The phone keeps where it stood relative to the place for the last ten minutes and trusts
 * the trend once it is a few minutes long. A walking-pace trend is trusted only near the place:
 * farther away people walk to a stop or a car first.
 */
export const PROGRESS = {
  windowMs: 10 * 60_000,
  /** One sample per half minute is plenty. */
  everyMs: 30_000,
  minSpanMs: 3 * 60_000,
  /** Getting closer at least this fast (m/s) is being on the way. */
  minRate: 0.7,
  /** Faster than anyone walks: trusted at any distance. */
  rideRate: 2.5,
  walkTrustM: 3_000,
  /** The trend may say at most this much faster or slower than the typical estimate. */
  clamp: { min: 0.5, max: 3 },
} as const;

/** The samples with a new one: at most one per half minute, none older than the window. */
export function withProgress(track: readonly Progress[], next: Progress): Progress[] {
  const last = track.at(-1);
  const kept = track.filter((sample) => next.ts - sample.ts <= PROGRESS.windowMs);
  if (last !== undefined && next.ts - last.ts < PROGRESS.everyMs) return kept;
  return [...kept, next];
}

/** Metres per second towards the place over the kept minutes; null without a clear trend. */
export function approachRate(track: readonly Progress[]): number | null {
  const first = track[0];
  const last = track.at(-1);
  if (first === undefined || last === undefined) return null;
  const span = last.ts - first.ts;
  if (span < PROGRESS.minSpanMs) return null;
  const rate = ((first.remaining - last.remaining) / span) * 1000;
  return rate >= PROGRESS.minRate ? rate : null;
}

/**
 * When someone will be at the place: from the trend of their own progress when there is one, else
 * from the distance at a typical speed for how they travel (their choice, or what the phone sees).
 */
export function estimateArrival(input: {
  now: number;
  remaining: number;
  activity: Activity;
  mode?: TravelMode | undefined;
  rate?: number | null;
}): number {
  const { now, remaining } = input;
  if (remaining === 0) return now;
  const typical = travelMs(remaining, input.mode ?? travelMode(remaining, input.activity));
  const rate = input.rate ?? null;
  if (rate === null || (rate < PROGRESS.rideRate && remaining > PROGRESS.walkTrustM)) {
    return now + typical;
  }
  const trend = (remaining / rate) * 1000;
  return (
    now +
    Math.round(
      Math.min(Math.max(trend, typical * PROGRESS.clamp.min), typical * PROGRESS.clamp.max),
    )
  );
}

/** When someone at `from` will be at the place, leaving now at a typical speed. */
export function arrivalAt(
  from: Point,
  place: Area,
  now: number,
  activity: Activity,
  mode?: TravelMode,
): number {
  return estimateArrival({ now, remaining: distanceTo(from, place), activity, mode });
}

/** Whether phones estimate their arrival now ("Kim ne zaman orada?"). */
export function inEtaWindow(meetAt: number, now: number): boolean {
  return now >= meetAt - MEETING.etaFromMs && now <= meetAt + MEETING.etaUntilMs;
}

/** Minutes late, in steps of five; 0 when on time or only a little late. */
export function lateMinutes(arrival: number, meetAt: number): number {
  const minutes = (arrival - meetAt) / 60_000;
  if (minutes < MEETING.lateAfterMin) return 0;
  return Math.min(600, Math.ceil(minutes / MEETING.lateRoundMin) * MEETING.lateRoundMin);
}

/** Whether this lateness is news: the first one, or grown by a step since the last told. */
export function lateIsNews(minutes: number, told: number | undefined): boolean {
  return minutes > 0 && (told === undefined || minutes >= told + MEETING.lateStepMin);
}

/**
 * When to remind someone to leave ("15 dk içinde çıkmalısın"): a quarter of an hour before the
 * time to leave, which keeps a few minutes to spare. Null when they are close enough already.
 */
export function leaveReminderAt(
  from: Point,
  place: Area,
  meetAt: number,
  mode?: TravelMode,
): { remindAt: number; leaveAt: number } | null {
  const distance = distanceTo(from, place);
  if (distance <= MEETING.nearM) return null;
  const leaveAt =
    meetAt - MEETING.bufferMs - travelMs(distance, mode ?? travelMode(distance, 'still'));
  return { remindAt: leaveAt - MEETING.leaveNoticeMs, leaveAt };
}

/** The votes of a poll: per option, how many and who; the leading option (ties: the first). */
export interface Tally {
  counts: number[];
  voters: string[][];
  leader: number | null;
}

/** Counts each current member's vote once (a vote is filed under its voter, docs.ts checks). */
export function tally(
  poll: PollPayload,
  votes: readonly Doc<VotePayload>[],
  members: ReadonlySet<string>,
): Tally {
  const counts = poll.options.map(() => 0);
  const voters: string[][] = poll.options.map(() => []);
  const latest = new Map<string, VotePayload>();
  for (const vote of votes) {
    if (vote.payload.pollId !== poll.id || !members.has(vote.authorId)) continue;
    const held = latest.get(vote.authorId);
    if (held === undefined || vote.payload.ts > held.ts) latest.set(vote.authorId, vote.payload);
  }
  for (const [userId, vote] of latest) {
    for (const choice of new Set(vote.choices)) {
      if (choice >= poll.options.length) continue;
      counts[choice] = (counts[choice] ?? 0) + 1;
      voters[choice]?.push(userId);
    }
  }
  const best = Math.max(0, ...counts);
  return { counts, voters, leader: best === 0 ? null : counts.indexOf(best) };
}

/** The meeting with a closed poll's choice applied: its time, or its place. */
export function withChoice(plan: PlanPayload, poll: PollPayload, choice: number): PlanPayload {
  const option = poll.options[choice];
  if (option === undefined) return plan;
  return 'at' in option ? { ...plan, meetAt: option.at } : { ...plan, placeId: option.placeId };
}

/** Where someone stands for the meeting, as everyone sees it on the board. */
export type Arrival =
  /** `by`: an exact location inside the place, or their own word ("Geldim"). */
  | { userId: string; state: 'there'; by: 'location' | 'word' }
  /** `estimated`: their phone's estimate says so (exact sharing only), not only their own word. */
  | { userId: string; state: 'coming'; at: number; late: number; estimated: boolean }
  | { userId: string; state: 'unknown' };

/** A location this old says nothing about the meeting any more. */
const ARRIVAL_FRESH_MS = 15 * 60_000;

/**
 * "Kim ne zaman orada?": there (inside the place), coming (with the time their phone estimated
 * for this meeting), or unknown (not sharing their exact location, or nothing recent). Those
 * there first, then by arrival, the unknown last.
 */
export function arrivals(input: {
  meetAt: number;
  place: Area;
  members: readonly string[];
  locations: Readonly<Record<string, LocPayload | undefined>>;
  /** Minutes late as people said themselves ("Geç kalacağım"), for this meeting. */
  told?: Readonly<Record<string, number | undefined>>;
  /** Who said "Geldim" themselves, for this meeting (docs/ADR/0026 §5). */
  arrived?: ReadonlySet<string>;
  now: number;
}): Arrival[] {
  const { meetAt, place, now } = input;
  const rows = input.members.map((userId): Arrival => {
    const loc = input.locations[userId];
    const fresh = loc !== undefined && now - loc.ts <= ARRIVAL_FRESH_MS ? loc : undefined;
    // Only an exact location tells an arrival (a coarse one is a cell's centre), or their word.
    const exact = fresh !== undefined && fresh.acc <= MEETING.arrivalAccuracyM ? fresh : undefined;
    if (exact !== undefined && distanceM(exact, place) <= place.radius) {
      return { userId, state: 'there', by: 'location' };
    }
    if (input.arrived?.has(userId) === true) return { userId, state: 'there', by: 'word' };
    // Their own word counts when it says later than their phone's estimate. An estimate only
    // with an exact location: a coarse sharer's phone sends none, and one that did is not taken
    // (QA 22).
    const said = input.told?.[userId];
    const estimate = exact?.eta?.meetAt === meetAt ? exact.eta.at : undefined;
    const at = Math.max(estimate ?? 0, said === undefined ? 0 : meetAt + said * 60_000);
    if (at === 0) return { userId, state: 'unknown' };
    return {
      userId,
      state: 'coming',
      at,
      late: lateMinutes(at, meetAt),
      estimated: estimate !== undefined,
    };
  });
  const rank = (row: Arrival) =>
    row.state === 'there' ? -1 : row.state === 'coming' ? row.at : Number.MAX_SAFE_INTEGER;
  return rows.sort((a, b) => rank(a) - rank(b));
}

/** A meeting's numbers at a glance (the map's meeting chip, docs/ADR/0026 §8). */
export interface Headcount {
  there: number;
  /** On the way by their phone's estimate: only who shares their exact location with the circle. */
  coming: number;
  total: number;
  /** Everyone there, each by an exact location (the meeting effect, never from a coarse one). */
  allThereExactly: boolean;
}

/**
 * Counts by the meeting's privacy rules (docs/ADR/0026 §5): "there" as the board says it, "on the
 * way" only from an estimate (a ghost or a coarse sharer sends none: counted in the total, their
 * state not shown), the effect only when all are there by an exact location.
 */
export function headcount(rows: readonly Arrival[]): Headcount {
  const there = rows.filter((row) => row.state === 'there');
  return {
    there: there.length,
    coming: rows.filter((row) => row.state === 'coming' && row.estimated).length,
    total: rows.length,
    allThereExactly:
      rows.length > 1 &&
      there.length === rows.length &&
      there.every((row) => row.by === 'location'),
  };
}

/** Meeting times offered from now to the event's end, in quarter hours. */
export function meetingTimes(now: number, endsAt: number): number[] {
  const first = Math.ceil((now + MEETING.stepMs) / MEETING.stepMs) * MEETING.stepMs;
  const times: number[] = [];
  for (let at = first; at <= endsAt; at += MEETING.stepMs) times.push(at);
  return times;
}
