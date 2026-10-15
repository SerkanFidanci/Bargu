import type { Circle } from '@bargu/schemas';

import type { Place } from '../places/place-model';
import { docKey } from './docs';
import { meetingPoints } from './meeting-points';
import type { Doc } from './plan-model';

const HOUR = 3_600_000;
const NOW = 100 * HOUR;
const eventId = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const placeId = '0190f7a4-2222-7222-8222-000000000001';

const circle = (overrides: Partial<Circle> = {}): Circle => ({
  id: eventId,
  kind: 'event',
  name: 'Konser',
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [],
  startedAt: NOW - HOUR,
  expiresAt: NOW + 3 * HOUR,
  ...overrides,
});
const place = (overrides: Partial<Place> = {}): Place => ({
  id: placeId,
  circleId: eventId,
  version: 1,
  name: 'Sahne',
  emoji: '🎸',
  lat: 41.0082,
  lng: 28.9784,
  radius: 100,
  ts: 1,
  ...overrides,
});
const planned = (plan: { meetAt?: number; placeId?: string }): Record<string, Doc> => ({
  [docKey(eventId, eventId)]: {
    circleId: eventId,
    version: 1,
    shared: true,
    authorId: 'someone',
    payload: { kind: 'plan', id: eventId, ...plan, ts: 1 },
  },
});

describe('meeting points on the map', () => {
  it("mark an event's meeting place, with its time once set", () => {
    const places = { [placeId]: place() };
    expect(
      meetingPoints([circle()], planned({ placeId, meetAt: NOW + HOUR }), places, NOW),
    ).toEqual([{ circleId: eventId, event: 'Konser', place: place(), meetAt: NOW + HOUR }]);
    expect(meetingPoints([circle()], planned({ placeId }), places, NOW)[0]?.meetAt).toBeUndefined();
  });

  it('mark nothing without a place, for a group, an invitation, an ended event or a foreign place', () => {
    const places = { [placeId]: place() };
    const plan = planned({ placeId, meetAt: NOW + HOUR });
    expect(meetingPoints([circle()], planned({ meetAt: NOW + HOUR }), places, NOW)).toEqual([]);
    expect(meetingPoints([circle({ kind: 'friends' })], plan, places, NOW)).toEqual([]);
    expect(meetingPoints([circle({ myStatus: 'invited' })], plan, places, NOW)).toEqual([]);
    expect(meetingPoints([circle({ expiresAt: NOW })], plan, places, NOW)).toEqual([]);
    const foreign = { [placeId]: place({ circleId: '0190f7a4-5b6c-7d8e-9f01-000000000000' }) };
    expect(meetingPoints([circle()], plan, foreign, NOW)).toEqual([]);
  });
});
