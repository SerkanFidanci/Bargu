import type { LngLat } from '@maplibre/maplibre-react-native';

import { distanceM } from '../location/send';
import type { Place } from '../places/place-model';
import type { MeetingPoint } from '../plan/meeting-points';
import { distanceTo, MEETING } from '../plan/plan-model';

/** The map's shortcuts and meeting chip (the project owner's request, docs/ADR/0026 §8). */
export const SHORTCUTS = {
  /** "Back to me" shows once the map's centre is this far from this phone (screen points). */
  awayPx: 64,
  /** The chip counts down once the meeting is this close… */
  countdownMs: 60 * 60_000,
  /** …and stands out in the last stretch. */
  closeMs: 10 * 60_000,
  /** "Geldim" shows from this long before the time… */
  hereFromMs: 15 * 60_000,
  /** …or sooner, within the arrival estimates' window, when this phone is this near the place. */
  hereNearM: MEETING.nearM,
} as const;

/** Metres a screen point covers at a zoom and latitude (web mercator, 512 px tiles). */
function metresPerPoint(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** Whether the map looks away from this phone: then "back to me" is offered. */
export function isAway(
  center: LngLat,
  zoom: number,
  me: { lat: number; lng: number } | null,
): boolean {
  if (me === null) return false;
  const [lng, lat] = center;
  return distanceM({ lat, lng }, me) > SHORTCUTS.awayPx * metresPerPoint(zoom, lat);
}

/** A meeting the chip can show: its place known and its time set. */
export type TimedPoint = MeetingPoint & { meetAt: number };

/**
 * The meeting the chip shows: the earliest one still on (until its time + MEETING.keptMs), and how
 * many more there are.
 */
export function nextMeeting(
  points: readonly MeetingPoint[],
  now: number,
): { point: TimedPoint; more: number } | null {
  const timed = points
    .filter(
      (point): point is TimedPoint =>
        point.state === 'set' && point.meetAt !== undefined && point.meetAt + MEETING.keptMs > now,
    )
    .sort((a, b) => a.meetAt - b.meetAt);
  const [first] = timed;
  return first === undefined ? null : { point: first, more: timed.length - 1 };
}

/**
 * Where the countdown stands: `later` (only the time), `soon` (minutes left), `close` (the last
 * stretch, stands out), `now` (from its time: who is there).
 */
export function countdown(
  meetAt: number,
  now: number,
): { phase: 'later' | 'soon' | 'close' | 'now'; minutes: number } {
  const left = meetAt - now;
  if (left <= 0) return { phase: 'now', minutes: 0 };
  const minutes = Math.ceil(left / 60_000);
  if (left > SHORTCUTS.countdownMs) return { phase: 'later', minutes };
  return { phase: left > SHORTCUTS.closeMs ? 'soon' : 'close', minutes };
}

/**
 * Whether "Geldim" is offered: around the time, or near the place within the estimates' window;
 * never once this phone said it, nor in a paused circle (the server would refuse it).
 */
export function hereDue(input: {
  meetAt: number;
  place: Pick<Place, 'lat' | 'lng' | 'radius'>;
  fix: { lat: number; lng: number } | null;
  now: number;
  said: boolean;
  paused: boolean;
}): boolean {
  const { meetAt, now } = input;
  if (input.said || input.paused || now > meetAt + MEETING.keptMs) return false;
  if (now >= meetAt - SHORTCUTS.hereFromMs) return true;
  if (now < meetAt - MEETING.etaFromMs || input.fix === null) return false;
  return distanceTo(input.fix, input.place) <= SHORTCUTS.hereNearM;
}
