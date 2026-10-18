import { glide } from '@/theme/motion';

/** A position on the map. */
export interface GlidePoint {
  lat: number;
  lng: number;
}

/** What gliding needs of a location (received or this phone's own). */
export interface GlideFix extends GlidePoint {
  /** m/s, when known. */
  spd?: number | null | undefined;
  /** Degrees from north, when known. */
  hdg?: number | null | undefined;
  /** Accuracy radius (m), when known. */
  acc?: number | undefined;
  /** When it was measured (Unix ms). */
  ts: number;
}

/** One animation of a marker: where to, in how long, and whether at constant speed. */
export interface GlideStep {
  to: GlidePoint;
  durationMs: number;
  /** Constant speed (a moving person); otherwise it eases into place. */
  linear: boolean;
}

const EARTH_RADIUS_M = 6_371_000;
const RAD = Math.PI / 180;

/** Great-circle distance in metres (haversine). */
export function distanceBetween(a: GlidePoint, b: GlidePoint): number {
  const dLat = (b.lat - a.lat) * RAD;
  const dLng = (b.lng - a.lng) * RAD;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The point `metres` away from `from` towards `headingDeg` (flat approximation; metres are few). */
export function project(from: GlidePoint, headingDeg: number, metres: number): GlidePoint {
  const angle = headingDeg * RAD;
  const north = Math.cos(angle) * metres;
  const east = Math.sin(angle) * metres;
  return {
    lat: from.lat + north / (EARTH_RADIUS_M * RAD),
    lng: from.lng + east / (EARTH_RADIUS_M * RAD * Math.cos(from.lat * RAD)),
  };
}

/** Whether a fix says its person is moving, with a direction. */
export function isMoving(fix: Pick<GlideFix, 'spd' | 'hdg'>): boolean {
  return (
    fix.spd !== null &&
    fix.spd !== undefined &&
    fix.spd >= glide.movingSpeed &&
    fix.hdg !== null &&
    fix.hdg !== undefined
  );
}

/** Whether a location is too rough to point at (a circle shows where they may be), not a cell. */
export function isRough(acc: number | undefined): boolean {
  return acc !== undefined && acc > glide.roughAccuracyM && acc < glide.cellAccuracyM;
}

/** Degrees between two headings (0–180). */
function turn(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

/**
 * How far ahead of the location (m) the pin may go: only on a straight, steady, well measured
 * course, never on a bend, when slowing to a stop or for a rough location.
 */
function lead(fix: GlideFix, previous: GlideFix, aheadMs: number): number {
  const { spd, hdg, acc } = fix;
  if (spd === null || spd === undefined || spd < glide.leadSpeed) return 0;
  if (hdg === null || hdg === undefined || previous.hdg === null || previous.hdg === undefined) {
    return 0;
  }
  if (acc === undefined || acc > glide.leadAccuracyM) return 0;
  if (turn(previous.hdg, hdg) >= glide.leadTurnDeg) return 0;
  return spd * (Math.min(aheadMs, glide.leadMs) / 1000);
}

/**
 * How a marker moves when a new location arrives (docs/ADR/0028), or null to leave it: one
 * measured before the location it shows arrived late, and the pin never steps back. The first
 * location, one after a long gap and one far away are placed; otherwise the pin glides from where
 * it is to the location over the gap between the two (×1.1, within limits), a moving person at
 * constant speed, and on a straight steady course to at most `glide.leadMs` past it.
 */
export function glideStep(input: {
  shown: GlidePoint;
  fix: GlideFix;
  /** The location the marker had before this one; null for its first. */
  previous: GlideFix | null;
  now: number;
}): GlideStep | null {
  const { shown, fix, previous, now } = input;
  if (previous !== null && fix.ts < previous.ts) return null;
  const target: GlidePoint = { lat: fix.lat, lng: fix.lng };
  if (
    previous === null ||
    fix.ts - previous.ts > glide.jumpGapMs ||
    distanceBetween(shown, target) > glide.teleportM
  ) {
    return { to: target, durationMs: 0, linear: false };
  }
  const durationMs = Math.min(
    Math.max((fix.ts - previous.ts) * glide.spanFactor, glide.minSpanMs),
    glide.maxSpanMs,
  );
  const linear = isMoving(fix);
  // By the glide's end the location is its age plus the glide old; the guess covers at most 1 s.
  const ahead = lead(fix, previous, Math.max(0, now - fix.ts) + durationMs);
  return { to: ahead === 0 ? target : project(target, fix.hdg ?? 0, ahead), durationMs, linear };
}

/** Trail length for a speed: 0 none (still), 1 walking, 2 cycling or running, 3 in a vehicle. */
export function trailLevel(spd: number | null | undefined): 0 | 1 | 2 | 3 {
  if (spd === null || spd === undefined) return 0;
  const [walk, bike, vehicle] = glide.trailSpeeds;
  if (spd >= vehicle) return 3;
  if (spd >= bike) return 2;
  if (spd >= walk) return 1;
  return 0;
}
