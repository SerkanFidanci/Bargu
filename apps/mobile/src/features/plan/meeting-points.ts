import type { Circle } from '@bargu/schemas';

import { touchTarget } from '@/theme/layout';

import { memberName } from '../circles/names';
import { worldPx } from '../map/cluster';
import type { Place } from '../places/place-model';
import { docKey } from './docs';
import { meetingPlace } from './meeting';
import { type Doc, MEETING } from './plan-model';

/**
 * A meeting on the map (docs/ADR/0026 §3): where a circle's people meet, never drawn like a saved
 * place. `set`: the meeting's place (with its time, once set); `voting`: an event's place still in
 * a poll; `option`: another of an event's places, not chosen yet.
 */
export interface MeetingPoint {
  circleId: string;
  /** The event's name, or the circle's (a friendship by the friend). */
  title: string;
  place: Place;
  meetAt: number | undefined;
  state: 'set' | 'voting' | 'option';
}

function titleOf(circle: Circle, me: string | null): string {
  if (circle.kind !== 'pair') return circle.name ?? '';
  const friend = circle.members.find((member) => member.userId !== me);
  return friend === undefined ? '' : memberName(friend);
}

/**
 * The meetings to mark on the map, worked out from what the phone already holds (nothing is asked
 * of anyone):
 * - an event this phone is active in, until it ends: its meeting place once chosen; before that
 *   every one of its places, those in an open poll marked as voted on (an event's places are its
 *   meeting's, so none of them looks like a saved place);
 * - any other circle's meeting, until it goes (its time + MEETING.keptMs).
 */
export function meetingPoints(
  circles: readonly Circle[],
  docs: Readonly<Record<string, Doc>>,
  places: Readonly<Record<string, Place>>,
  now: number,
  me: string | null = null,
): MeetingPoint[] {
  return circles.flatMap((circle): MeetingPoint[] => {
    if (circle.myStatus !== 'active') return [];
    const plan = docs[docKey(circle.id, circle.id)]?.payload;
    const meeting = plan?.kind === 'plan' ? plan : undefined;
    const point = (place: Place, state: MeetingPoint['state']): MeetingPoint => ({
      circleId: circle.id,
      title: titleOf(circle, me),
      place,
      meetAt: state === 'set' ? meeting?.meetAt : undefined,
      state,
    });
    const chosen = meeting === undefined ? undefined : meetingPlace(meeting, places);
    if (circle.kind === 'event') {
      if (circle.expiresAt !== undefined && circle.expiresAt <= now) return [];
      if (chosen?.circleId === circle.id) return [point(chosen, 'set')];
      const voted = new Set(
        Object.values(docs).flatMap((doc) =>
          doc.circleId === circle.id &&
          doc.payload.kind === 'poll' &&
          doc.payload.about === 'place' &&
          doc.payload.closed === undefined
            ? doc.payload.options.flatMap((option) => ('placeId' in option ? [option.placeId] : []))
            : [],
        ),
      );
      return Object.values(places)
        .filter((place) => place.circleId === circle.id)
        .map((place) => point(place, voted.has(place.id) ? 'voting' : 'option'));
    }
    // Outside an event: the meeting, while it lasts; the circle's place looks like a meeting then.
    if (meeting?.meetAt === undefined || chosen?.circleId !== circle.id) return [];
    if (meeting.meetAt + MEETING.keptMs <= now) return [];
    return [point(chosen, 'set')];
  });
}

/**
 * A meeting's tag on screen, about (px): as wide as the longest name it shows, one touch target
 * tall. The meeting's own flag stands above its point, the others sit on it.
 */
const TAG = { width: 180, height: touchTarget } as const;

/** Meetings whose tags would overlap at this zoom: one card, a row each (the owner, 2026-10-18). */
export interface MeetingGroup {
  /** Stable while the same meetings are in it. */
  key: string;
  points: MeetingPoint[];
  lat: number;
  lng: number;
}

export const pointKey = (point: MeetingPoint) => `${point.circleId}:${point.place.id}`;

/** The meeting first, then places being voted on, then the rest; by name within each. */
const ORDER: Record<MeetingPoint['state'], number> = { set: 0, voting: 1, option: 2 };

function tagBox(point: MeetingPoint, zoom: number) {
  const { x, y } = worldPx(point.place.lat, point.place.lng, zoom);
  const top = point.state === 'set' ? y - TAG.height : y - TAG.height / 2;
  return { left: x - TAG.width / 2, right: x + TAG.width / 2, top, bottom: top + TAG.height };
}

/**
 * Groups the meetings whose tags would overlap at this zoom (two of an event's places a street
 * apart: one hid the other and could not be tapped). Any chain of overlapping tags is one group;
 * a meeting alone is a group of one. Zooming in separates them again.
 */
export function groupMeetingPoints(points: readonly MeetingPoint[], zoom: number): MeetingGroup[] {
  const boxes = points.map((point) => ({ point, box: tagBox(point, zoom) }));
  type Boxed = (typeof boxes)[number];
  const touch = (a: Boxed, b: Boxed) =>
    a.box.left < b.box.right &&
    b.box.left < a.box.right &&
    a.box.top < b.box.bottom &&
    b.box.top < a.box.bottom;
  let groups: Boxed[][] = [];
  for (const boxed of boxes) {
    const near = groups.filter((group) => group.some((member) => touch(member, boxed)));
    groups = [...groups.filter((group) => !near.includes(group)), [...near.flat(), boxed]];
  }
  return groups
    .map((group) => {
      const sorted = group
        .map(({ point }) => point)
        .sort(
          (a, b) =>
            ORDER[a.state] - ORDER[b.state] ||
            a.place.name.localeCompare(b.place.name) ||
            pointKey(a).localeCompare(pointKey(b)),
        );
      return {
        key: sorted.map(pointKey).join('+'),
        points: sorted,
        lat: sorted.reduce((sum, point) => sum + point.place.lat, 0) / sorted.length,
        lng: sorted.reduce((sum, point) => sum + point.place.lng, 0) / sorted.length,
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}
