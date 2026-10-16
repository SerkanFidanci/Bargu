import type { Circle } from '@bargu/schemas';

import { memoryStore } from '../location/test-support';
import { DEFAULT_SHARING, type SharingSettings } from '../location/sharing';
import type { Place } from '../places/place-model';
import { docKey } from './docs';
import { createMeetings, meetingOf, type MeetingDeps } from './meeting';
import { distanceTo, type Doc, MEETING, travelMs } from './plan-model';

const MIN = 60_000;
const circleId = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const placeId = '0190f7a4-2222-7222-8222-000000000001';
const meetAt = 1_000 * MIN;
const place: Place = {
  id: placeId,
  circleId,
  version: 1,
  name: 'Sahne',
  emoji: '🎸',
  lat: 41.0082,
  lng: 28.9784,
  radius: 100,
  ts: 1,
};
const circle: Pick<Circle, 'id' | 'epoch' | 'kind' | 'myStatus'> = {
  id: circleId,
  epoch: 1,
  kind: 'event',
  myStatus: 'active',
};
const planDoc = (plan: { meetAt?: number; placeId?: string }): Doc => ({
  circleId,
  version: 1,
  shared: true,
  authorId: 'someone',
  payload: { kind: 'plan', id: circleId, ...plan, ts: 1 },
});
/** A still phone `meters` north of the place's centre at `ts`. */
const at = (meters: number, ts: number) => ({
  lat: place.lat + meters / 111_320,
  lng: place.lng,
  acc: 10,
  spd: 0,
  hdg: null,
  ts,
});

function setup(options: {
  sharing?: SharingSettings;
  clock: { now: number };
  /** Whether sending "will be late" fails now (no connection). */
  offline?: () => boolean;
  paused?: boolean;
}) {
  const store = memoryStore();
  const sent: number[] = [];
  const tries = { count: 0 };
  const reminders: { at: number | null; body: string }[] = [];
  const cancelled: string[] = [];
  const docs = { [docKey(circleId, circleId)]: planDoc({ meetAt, placeId }) };
  const deps: MeetingDeps = {
    circles: () => [{ ...circle, paused: options.paused }],
    docs: () => docs,
    places: () => ({ [placeId]: place }),
    sharing: () => options.sharing ?? DEFAULT_SHARING,
    store: () => store,
    sendLate: (_circle, _meetAt, minutes) => {
      tries.count += 1;
      if (options.offline?.() === true) return Promise.reject(new Error('offline'));
      sent.push(minutes);
      return Promise.resolve();
    },
    remind: (_circleId, when, text) => {
      reminders.push({ at: when, body: text.body });
      return Promise.resolve();
    },
    cancel: (id) => {
      cancelled.push(id);
      return Promise.resolve();
    },
    words: (_meeting, minutes) => ({ title: 'Sahne', body: `${String(minutes)} dk` }),
    now: () => options.clock.now,
  };
  return { meetings: createMeetings(deps), sent, tries, reminders, cancelled, store };
}

describe('the meeting of an event', () => {
  it('is known once both its time and its place are', () => {
    const places = { [placeId]: place };
    expect(meetingOf(circleId, { [docKey(circleId, circleId)]: planDoc({ meetAt }) }, places)).toBe(
      null,
    );
    expect(
      meetingOf(circleId, { [docKey(circleId, circleId)]: planDoc({ meetAt, placeId }) }, places),
    ).toEqual({ circleId, meetAt, place });
    // A place of another circle does not count.
    expect(
      meetingOf(
        circleId,
        { [docKey(circleId, circleId)]: planDoc({ meetAt, placeId }) },
        { [placeId]: { ...place, circleId: 'other' } },
      ),
    ).toBe(null);
  });
});

describe('arrival estimates', () => {
  it('go with the location only around the meeting', () => {
    const clock = { now: meetAt - 100 * MIN };
    const { meetings } = setup({ clock });
    expect(meetings.eta(circleId, at(1_100, clock.now), clock.now)).toBeUndefined();
    clock.now = meetAt - 30 * MIN;
    const left = distanceTo(at(1_100, 0), place);
    expect(meetings.eta(circleId, at(1_100, clock.now), clock.now)).toEqual({
      meetAt,
      at: clock.now + travelMs(left, 'walk'),
    });
    // Coming by car, as the user chose.
    meetings.setMode(circleId, 'vehicle');
    expect(meetings.eta(circleId, at(1_100, clock.now), clock.now)?.at).toBe(
      clock.now + travelMs(left, 'vehicle'),
    );
  });
});

describe('progress on the way', () => {
  it('shows in the estimate: crawling in traffic is later than a typical drive', async () => {
    const clock = { now: meetAt - 60 * MIN };
    const { meetings } = setup({ clock });
    // Driving towards the place at 3 m/s, a position every half minute for five minutes.
    let fix = at(9_100, clock.now);
    for (let i = 0; i <= 10; i++) {
      clock.now = meetAt - 60 * MIN + i * 30_000;
      fix = { ...at(9_100 - i * 90, clock.now), spd: 9 };
      await meetings.fix(fix);
    }
    const typical = clock.now + travelMs(distanceTo(fix, place), 'vehicle');
    expect(meetings.eta(circleId, fix, clock.now)?.at).toBeGreaterThan(typical);
  });
});

describe('being late', () => {
  it('is told once, again only when it grows, and only with the exact location shared', async () => {
    // Two kilometres away on foot, five minutes before: clearly late.
    const clock = { now: meetAt - 5 * MIN };
    const { meetings, sent } = setup({ clock });
    meetings.setMode(circleId, 'walk');
    await meetings.fix(at(2_100, clock.now));
    // Not at once: a short stop or detour is not news.
    expect(sent).toEqual([]);
    clock.now += MEETING.lateHoldMs;
    await meetings.fix(at(2_100, clock.now));
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBeGreaterThanOrEqual(MEETING.lateAfterMin);
    // A little later and a little farther: not news.
    clock.now += MIN;
    await meetings.fix(at(2_150, clock.now));
    expect(sent).toHaveLength(1);
    // Much farther: told again.
    await meetings.fix(at(4_000, clock.now));
    expect(sent).toHaveLength(2);

    const quiet = setup({
      clock: { now: meetAt - 5 * MIN },
      sharing: {
        ghost: 'off',
        circles: { [circleId]: { sharing: true, precision: 'neighborhood', until: null } },
      },
    });
    await quiet.meetings.fix(at(2_100, meetAt - 5 * MIN));
    await quiet.meetings.fix(at(2_100, meetAt - 5 * MIN + MEETING.lateHoldMs));
    expect(quiet.sent).toEqual([]);
  });

  it('is tried again later when it did not get through, not with every position (Faz 8 D10)', async () => {
    const clock = { now: meetAt - 5 * MIN };
    let offline = true;
    const { meetings, sent, tries } = setup({ clock, offline: () => offline });
    meetings.setMode(circleId, 'walk');
    await meetings.fix(at(2_100, clock.now));
    clock.now += MEETING.lateHoldMs;
    await meetings.fix(at(2_100, clock.now));
    expect(tries.count).toBe(1);
    // A position every few seconds: no new try until the wait is over.
    for (let i = 0; i < 10; i++) {
      clock.now += 5_000;
      await meetings.fix(at(2_100, clock.now));
    }
    expect(tries.count).toBe(1);
    clock.now += MEETING.lateRetryMs;
    await meetings.fix(at(2_100, clock.now));
    expect(tries.count).toBe(2);
    // Twice as long after the second failure.
    clock.now += MEETING.lateRetryMs;
    await meetings.fix(at(2_100, clock.now));
    expect(tries.count).toBe(2);
    clock.now += MEETING.lateRetryMs;
    offline = false;
    await meetings.fix(at(2_100, clock.now));
    expect(tries.count).toBe(3);
    expect(sent).toHaveLength(1);
    // Told: not again.
    clock.now += MIN;
    await meetings.fix(at(2_100, clock.now));
    expect(tries.count).toBe(3);
  });

  it('is not even tried in a paused circle (QA 21 B-4)', async () => {
    const clock = { now: meetAt - 5 * MIN };
    const { meetings, tries } = setup({ clock, paused: true });
    meetings.setMode(circleId, 'walk');
    await meetings.fix(at(2_100, clock.now));
    clock.now += MEETING.lateHoldMs;
    await meetings.fix(at(2_100, clock.now));
    expect(await meetings.late(circleId, 20)).toBe(false);
    expect(tries.count).toBe(0);
  });

  it('can be told by the user, whatever the estimate', async () => {
    const { meetings, sent } = setup({ clock: { now: meetAt - 60 * MIN } });
    expect(await meetings.late(circleId, 20)).toBe(true);
    expect(sent).toEqual([20]);
    expect(await meetings.late('0190f7a4-5b6c-7d8e-9f01-000000000000', 20)).toBe(false);
  });
});

describe('the reminder to leave', () => {
  it('is set a quarter of an hour before the time to leave, and not set again for small changes', async () => {
    const clock = { now: meetAt - 120 * MIN };
    const { meetings, reminders } = setup({ clock });
    await meetings.fix(at(3_100, clock.now));
    const left = distanceTo(at(3_100, 0), place);
    const leaveAt = meetAt - MEETING.bufferMs - travelMs(left, 'vehicle');
    expect(reminders).toEqual([{ at: leaveAt - 15 * MIN, body: '15 dk' }]);
    await meetings.fix(at(3_120, clock.now + MIN));
    expect(reminders).toHaveLength(1);
  });

  it('is taken back once they are clearly on their way, and not set nearby', async () => {
    const clock = { now: meetAt - 120 * MIN };
    const { meetings, reminders, cancelled } = setup({ clock });
    await meetings.fix(at(3_100, clock.now));
    clock.now += 5 * MIN;
    await meetings.fix(at(2_500, clock.now));
    expect(cancelled).toEqual([circleId]);
    expect(reminders).toHaveLength(1);

    const near = setup({ clock: { now: meetAt - 60 * MIN } });
    await near.meetings.fix(at(350, meetAt - 60 * MIN));
    expect(near.reminders).toEqual([]);
  });

  it('comes at once when the meeting is set late, and not when the user turned it off', async () => {
    const clock = { now: meetAt - 30 * MIN };
    const { meetings, reminders } = setup({ clock });
    await meetings.fix(at(1_400, clock.now));
    expect(reminders).toHaveLength(1);
    expect(reminders[0]?.at).toBeNull();

    const off = setup({ clock: { now: meetAt - 120 * MIN } });
    off.meetings.setRemind(circleId, false);
    await off.meetings.fix(at(3_100, meetAt - 120 * MIN));
    expect(off.reminders).toEqual([]);
  });

  it('is taken back with all this phone noted once the event is gone, and kept for others (Faz 9 O5)', async () => {
    const clock = { now: meetAt - 120 * MIN };
    const { meetings, cancelled, store } = setup({ clock });
    meetings.setRemind(circleId, false);
    meetings.setRemind(circleId, true);
    await meetings.fix(at(3_100, clock.now));
    const noted = () => store.keys().filter((key) => (store.get(key) ?? '').includes(circleId));
    expect(noted()).not.toEqual([]);

    await meetings.forget((id) => id !== circleId);
    expect(cancelled).toEqual([]);
    expect(noted()).not.toEqual([]);

    await meetings.forget((id) => id === circleId);
    expect(cancelled).toEqual([circleId]);
    expect(noted()).toEqual([]);
  });
});
