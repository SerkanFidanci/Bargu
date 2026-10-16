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

const optionId = '0190f7a4-2222-7222-8222-000000000002';
const polled = (options: string[]): Record<string, Doc> => ({
  [docKey(eventId, 'poll')]: {
    circleId: eventId,
    version: 1,
    shared: true,
    authorId: 'someone',
    payload: {
      kind: 'poll',
      id: '0190f7a4-3333-7333-8333-000000000003',
      by: 'someone',
      about: 'place',
      options: options.map((id) => ({ placeId: id, name: 'Yer' })),
      ts: 1,
    },
  },
});

describe('meeting points on the map (docs/ADR/0026 §3)', () => {
  it("mark an event's meeting place, with its time once set", () => {
    const places = { [placeId]: place(), [optionId]: place({ id: optionId, name: 'Kafe' }) };
    expect(
      meetingPoints([circle()], planned({ placeId, meetAt: NOW + HOUR }), places, NOW),
    ).toEqual([
      { circleId: eventId, title: 'Konser', place: place(), meetAt: NOW + HOUR, state: 'set' },
    ]);
    expect(meetingPoints([circle()], planned({ placeId }), places, NOW)[0]?.meetAt).toBeUndefined();
  });

  it("mark an event's places as its meeting's before one is chosen, those voted on so", () => {
    const places = { [placeId]: place(), [optionId]: place({ id: optionId, name: 'Kafe' }) };
    const points = meetingPoints(
      [circle()],
      { ...planned({ meetAt: NOW + HOUR }), ...polled([optionId]) },
      places,
      NOW,
    );
    expect(points.map((point) => [point.place.id, point.state]).sort()).toEqual(
      [
        [placeId, 'option'],
        [optionId, 'voting'],
      ].sort(),
    );
  });

  it("mark another circle's meeting while it lasts (3 hours past its time)", () => {
    const groupId = eventId;
    const family = circle({ kind: 'family', name: 'Aile', expiresAt: undefined });
    const home = { [placeId]: place({ circleId: groupId, name: 'Ev', emoji: '🏠' }) };
    const plan = planned({ placeId, meetAt: NOW + HOUR });
    expect(meetingPoints([family], plan, home, NOW)).toEqual([
      { circleId: groupId, title: 'Aile', place: home[placeId], meetAt: NOW + HOUR, state: 'set' },
    ]);
    expect(meetingPoints([family], plan, home, NOW + 4 * HOUR)).toEqual([]);
    // No time yet, or its place gone: nothing.
    expect(meetingPoints([family], planned({ placeId }), home, NOW)).toEqual([]);
    expect(meetingPoints([family], plan, {}, NOW)).toEqual([]);
  });

  it('mark nothing for an invitation, an ended event or a foreign place', () => {
    const places = { [placeId]: place() };
    const plan = planned({ placeId, meetAt: NOW + HOUR });
    expect(meetingPoints([circle({ myStatus: 'invited' })], plan, places, NOW)).toEqual([]);
    expect(meetingPoints([circle({ expiresAt: NOW })], plan, places, NOW)).toEqual([]);
    const foreign = { [placeId]: place({ circleId: '0190f7a4-5b6c-7d8e-9f01-000000000000' }) };
    expect(meetingPoints([circle()], plan, foreign, NOW)).toEqual([]);
  });
});
