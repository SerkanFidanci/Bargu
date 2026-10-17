import type { Place } from '../places/place-model';
import type { MeetingPoint } from '../plan/meeting-points';
import { MEETING } from '../plan/plan-model';
import { countdown, hereDue, isAway, nextMeeting, SHORTCUTS } from './shortcuts-model';

const MIN = 60_000;
const NOW = 1_000 * MIN;
const home: Place = {
  id: '0190f7a4-2222-7222-8222-000000000001',
  circleId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  version: 1,
  name: 'Ev',
  emoji: '🏠',
  lat: 41.03,
  lng: 28.95,
  radius: 100,
  ts: 1,
};
const point = (overrides: Partial<MeetingPoint> = {}): MeetingPoint => ({
  circleId: home.circleId,
  title: 'Aile',
  place: home,
  meetAt: NOW + 30 * MIN,
  state: 'set',
  ...overrides,
});
/** `metres` north of the place's centre. */
const north = (metres: number) => ({ lat: home.lat + metres / 111_320, lng: home.lng });

describe('the map shortcuts (docs/ADR/0026 §8)', () => {
  it('offer "back to me" only once the map looks clearly away from this phone', () => {
    const me = { lat: home.lat, lng: home.lng };
    const at = (metres: number): [number, number] => [north(metres).lng, north(metres).lat];
    // At a street's zoom a screen point is about a metre: a few metres off is still here.
    expect(isAway(at(20), 17, me)).toBe(false);
    expect(isAway(at(500), 17, me)).toBe(true);
    // Zoomed out over the city the same 500 m is a few points: not away.
    expect(isAway(at(500), 10, me)).toBe(false);
    // Without a position of its own there is nothing to go back to.
    expect(isAway(at(500), 17, null)).toBe(false);
  });

  it('show the next meeting coming, then one under way, with how many more (QA 22)', () => {
    const later = point({ circleId: 'b', meetAt: NOW + 2 * 60 * MIN });
    const gone = point({ circleId: 'c', meetAt: NOW - MEETING.keptMs });
    expect(nextMeeting([later, point(), gone], NOW)).toEqual({ point: point(), more: 1 });
    // One started an hour ago (still on) does not hide the one coming.
    const started = point({ circleId: 'd', meetAt: NOW - 60 * MIN });
    expect(nextMeeting([started, later], NOW)).toEqual({ point: later, more: 1 });
    // With nothing coming, the latest one under way.
    const earlier = point({ circleId: 'e', meetAt: NOW - 2 * 60 * MIN });
    expect(nextMeeting([earlier, started], NOW)?.point.circleId).toBe('d');
    // An event's places still voted on, or a meeting with no time: no chip.
    expect(
      nextMeeting([point({ state: 'voting' }), point({ meetAt: undefined }), gone], NOW),
    ).toBeNull();
  });

  it('count down in the last hour, stand out in its last minutes, and turn to who is there', () => {
    expect(countdown(NOW + 3 * 60 * MIN, NOW)).toEqual({ phase: 'later', minutes: 180 });
    expect(countdown(NOW + 25 * MIN, NOW)).toEqual({ phase: 'soon', minutes: 25 });
    expect(countdown(NOW + 10 * MIN, NOW)).toEqual({ phase: 'close', minutes: 10 });
    expect(countdown(NOW + 30_000, NOW)).toEqual({ phase: 'close', minutes: 1 });
    expect(countdown(NOW, NOW)).toEqual({ phase: 'now', minutes: 0 });
    expect(countdown(NOW - 5 * MIN, NOW)).toEqual({ phase: 'now', minutes: 0 });
  });

  it('offer "Geldim" near the time or the place, never twice, nor in a paused circle', () => {
    const meetAt = NOW + 60 * MIN;
    const base = { meetAt, place: home, fix: north(5_000), said: false, paused: false };
    // An hour ahead, far away: not yet.
    expect(hereDue({ ...base, now: NOW })).toBe(false);
    // Near the place within the estimates' window: yes, before its time.
    expect(hereDue({ ...base, fix: north(300), now: NOW })).toBe(true);
    // Near the place a day before: no.
    expect(hereDue({ ...base, fix: north(300), now: meetAt - 24 * 60 * MIN })).toBe(false);
    // Around its time, wherever this phone is (or without a position).
    expect(hereDue({ ...base, fix: null, now: meetAt - SHORTCUTS.hereFromMs })).toBe(true);
    expect(hereDue({ ...base, now: meetAt + 60 * MIN })).toBe(true);
    // Said already, paused, or the meeting over: no.
    expect(hereDue({ ...base, said: true, now: meetAt })).toBe(false);
    expect(hereDue({ ...base, paused: true, now: meetAt })).toBe(false);
    expect(hereDue({ ...base, now: meetAt + MEETING.keptMs + MIN })).toBe(false);
  });
});
