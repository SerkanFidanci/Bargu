import type { PlacePayload } from '@bargu/schemas';

import { distanceM, type Fix } from '../location/send';

/** A circle's place as this phone holds it: the decrypted message, and the server's version. */
export interface Place extends Omit<PlacePayload, 'kind'> {
  circleId: string;
  version: number;
}

/** The three sizes the editor snaps to (BARGU_PLAN §4.3: 100 / 250 / 500 m). */
export const PLACE_RADII = [100, 250, 500] as const;
export const DEFAULT_RADIUS = 250;

/** The offered size nearest to a dragged radius. */
export function snapRadius(meters: number): (typeof PLACE_RADII)[number] {
  return PLACE_RADII.reduce((best, radius) =>
    Math.abs(radius - meters) < Math.abs(best - meters) ? radius : best,
  );
}

/** Metres per screen point on the map at this zoom and latitude (512-pixel tiles, MapLibre). */
export function metersPerPoint(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Whether this phone is inside a place, and since when (kept per place on the phone). */
export interface Presence {
  inside: boolean;
  since: number;
}

/**
 * Leaving needs a margin beyond the circle, so a position wobbling on its edge does not announce
 * "arrived, left, arrived".
 */
export function exitMargin(radius: number): number {
  return Math.max(30, radius * 0.2);
}

/**
 * The next presence at a place for a new position, and whether that is an arrival or a departure.
 * Arriving: the position is in the circle. Leaving: even the near edge of its accuracy circle is
 * past the circle and the margin. Positions vaguer than the place itself say nothing. The first
 * position for a place only records where the phone is (no "arrived" for being there already).
 */
export function nextPresence(
  current: Presence | undefined,
  place: Pick<Place, 'lat' | 'lng' | 'radius'>,
  fix: Pick<Fix, 'lat' | 'lng' | 'acc' | 'ts'>,
): { presence: Presence | undefined; event: 'enter' | 'exit' | null } {
  if (fix.acc > Math.max(place.radius, 100)) return { presence: current, event: null };
  const distance = distanceM(fix, place);
  const inCircle = distance <= place.radius;
  const outside = distance - fix.acc > place.radius + exitMargin(place.radius);
  if (current === undefined) {
    return { presence: { inside: inCircle, since: fix.ts }, event: null };
  }
  if (!current.inside && inCircle)
    return { presence: { inside: true, since: fix.ts }, event: 'enter' };
  if (current.inside && outside)
    return { presence: { inside: false, since: fix.ts }, event: 'exit' };
  return { presence: current, event: null };
}

/** The place someone is at, as a viewer sees it: the smallest one containing their position. */
export function placeAt<T extends Pick<Place, 'lat' | 'lng' | 'radius'>>(
  places: readonly T[],
  at: { lat: number; lng: number },
): T | null {
  let best: T | null = null;
  for (const place of places) {
    if (distanceM(at, place) <= place.radius && (best === null || place.radius < best.radius)) {
      best = place;
    }
  }
  return best;
}

/** A point on the circle's edge, `bearing` degrees from north (for drawing it on the map). */
function offset(center: { lat: number; lng: number }, meters: number, bearing: number) {
  const r = 6_371_000;
  const d = meters / r;
  const b = (bearing * Math.PI) / 180;
  const lat1 = (center.lat * Math.PI) / 180;
  const lng1 = (center.lng * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI] as [number, number];
}

/** The place's circle as a closed GeoJSON ring of `steps` points (MapLibre draws polygons). */
export function circleRing(
  center: { lat: number; lng: number },
  meters: number,
  steps = 48,
): [number, number][] {
  const ring = Array.from({ length: steps }, (_, i) => offset(center, meters, (i * 360) / steps));
  const [first] = ring;
  return first === undefined ? ring : [...ring, first];
}
