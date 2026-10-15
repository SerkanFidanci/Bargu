import type { Circle } from '@bargu/schemas';

import type { Place } from '../places/place-model';
import { docKey } from './docs';
import type { Doc } from './plan-model';

/** An event's meeting point on the map: where (and, once set, when) its people meet. */
export interface MeetingPoint {
  circleId: string;
  event: string;
  place: Place;
  meetAt: number | undefined;
}

/**
 * The meeting points to mark on the map: one for each event this phone is active in whose
 * meeting place is set (its time may still be open), until the event ends. Worked out from what
 * the phone already holds; nothing is asked of anyone.
 */
export function meetingPoints(
  circles: readonly Circle[],
  docs: Readonly<Record<string, Doc>>,
  places: Readonly<Record<string, Place>>,
  now: number,
): MeetingPoint[] {
  return circles.flatMap((circle) => {
    if (circle.kind !== 'event' || circle.myStatus !== 'active') return [];
    if (circle.expiresAt !== undefined && circle.expiresAt <= now) return [];
    const plan = docs[docKey(circle.id, circle.id)]?.payload;
    if (plan?.kind !== 'plan' || plan.placeId === undefined) return [];
    const place = places[plan.placeId];
    if (place?.circleId !== circle.id) return [];
    return [{ circleId: circle.id, event: circle.name ?? '', place, meetAt: plan.meetAt }];
  });
}
