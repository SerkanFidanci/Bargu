import type { Circle } from '@bargu/schemas';

import { memberName } from '../circles/names';
import type { Place } from '../places/place-model';
import { docKey } from './docs';
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
    const chosen = meeting?.placeId === undefined ? undefined : places[meeting.placeId];
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
