import type { Circle, LocPayload } from '@bargu/schemas';

import { distanceM } from '../location/send';
import { estimateArrival, MEETING } from '../plan/plan-model';
import type { Place } from '../places/place-model';
import { activityOf } from './activity';

/** A home is a place drawn with this (the first choice of the place editor). */
export const HOME_EMOJI = '🏠';

/**
 * "Eve yaklaşık 12 dk" (Ö12, the PM 2026-10-29): only from a fresh, exact location, while they move
 * (speed and heading known) roughly toward a home no farther than this.
 */
export const HOME_ETA = {
  freshMs: 2 * 60_000,
  /** How far off their heading the home may lie (degrees either way). */
  headingDeg: 45,
  maxM: 50_000,
} as const;

/** The homes of the circles someone shares with this phone: places drawn with a house. */
export function homesOf(
  places: Readonly<Record<string, Place>>,
  circles: readonly Circle[],
  userId: string,
): Place[] {
  const shared = new Set(
    circles
      .filter(
        (circle) =>
          circle.myStatus === 'active' &&
          circle.members.some((member) => member.userId === userId && member.status === 'active'),
      )
      .map((circle) => circle.id),
  );
  return Object.values(places).filter(
    (place) => place.emoji === HOME_EMOJI && shared.has(place.circleId),
  );
}

/** The compass direction from one point to another, degrees from north. */
function bearingDeg(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLng = (to.lng - from.lng) * rad;
  const y = Math.sin(dLng) * Math.cos(to.lat * rad);
  const x =
    Math.cos(from.lat * rad) * Math.sin(to.lat * rad) -
    Math.sin(from.lat * rad) * Math.cos(to.lat * rad) * Math.cos(dLng);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * When someone on the move will be home, worked out on this phone from their location and the
 * homes of the circles shared with them; nothing when they stand, are home already, head
 * elsewhere, or the location is old or coarse. Rough on purpose: no routing, "yaklaşık".
 */
export function homeEta(
  loc: LocPayload,
  homes: readonly Place[],
  now: number,
): { place: Place; minutes: number } | null {
  if (now - loc.ts > HOME_ETA.freshMs || loc.acc > MEETING.arrivalAccuracyM) return null;
  if (loc.spd === undefined || loc.spd < MEETING.movingMps || loc.hdg === undefined) return null;
  if (loc.since !== undefined && now - loc.since >= MEETING.stillAfterMs) return null;
  const byDistance = homes
    .map((place) => ({ place, metres: distanceM(loc, place) }))
    .sort((a, b) => a.metres - b.metres);
  for (const { place, metres } of byDistance) {
    if (metres <= place.radius) return null;
    if (metres > HOME_ETA.maxM) break;
    const off = Math.abs(((bearingDeg(loc, place) - loc.hdg + 540) % 360) - 180);
    if (off > HOME_ETA.headingDeg) continue;
    const at = estimateArrival({
      now,
      remaining: metres - place.radius,
      activity: activityOf(loc.spd, 0),
    });
    return { place, minutes: Math.max(1, Math.ceil((at - now) / 60_000)) };
  }
  return null;
}
