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

/** Whether a fix says its person is moving, with a direction to extrapolate along. */
export function isMoving(fix: Pick<GlideFix, 'spd' | 'hdg'>): boolean {
  return (
    fix.spd !== null &&
    fix.spd !== undefined &&
    fix.spd >= glide.movingSpeed &&
    fix.hdg !== null &&
    fix.hdg !== undefined
  );
}

/**
 * How a marker moves when a new location arrives (dead reckoning, at most `glide.maxAheadMs`
 * past the measurement). A moving person is carried at constant speed from where the marker is
 * now to where they should be when the next location is due; a still one eases into place; a jump
 * farther than `glide.teleportM` is not animated.
 */
export function glideStep(input: {
  shown: GlidePoint;
  fix: GlideFix;
  now: number;
  /** Expected time until the next location (from the last gap between two of them). */
  intervalMs: number;
}): GlideStep {
  const { shown, fix, now } = input;
  const target: GlidePoint = { lat: fix.lat, lng: fix.lng };
  if (distanceBetween(shown, target) > glide.teleportM) {
    return { to: target, durationMs: 0, linear: false };
  }
  if (!isMoving(fix)) return { to: target, durationMs: glide.settle, linear: false };
  const interval = Math.min(Math.max(input.intervalMs, glide.minIntervalMs), glide.maxAheadMs);
  const age = Math.max(0, now - fix.ts);
  const ahead = Math.min(age + interval, glide.maxAheadMs);
  // Already as old as the limit: nothing left to extrapolate.
  if (ahead <= age) return { to: target, durationMs: glide.settle, linear: false };
  const metres = (fix.spd ?? 0) * (ahead / 1000);
  return {
    to: project(target, fix.hdg ?? 0, metres),
    durationMs: ahead - age,
    linear: true,
  };
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

/** Expected gap until the next location, from the last one (unknown: the moving default). */
export function nextInterval(previousAt: number | null, at: number): number {
  if (previousAt === null) return glide.defaultIntervalMs;
  return Math.min(Math.max(at - previousAt, glide.minIntervalMs), glide.maxAheadMs);
}
