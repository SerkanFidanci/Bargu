/** What the activity drawing shows (still people get none). */
export type GlyphActivity = 'walking' | 'running' | 'cycling' | 'driving' | 'settled';

/**
 * Angles for a drawn limb, as rotations in degrees: a positive rotation swings a hanging limb
 * backwards (to the left on the right-facing drawing), so "forward" is negative.
 */
export interface LimbPose {
  thigh: number;
  /** Relative to the thigh: positive folds the knee back. */
  shin: number;
  arm: number;
  /** Relative to the upper arm: negative bends the elbow forward. */
  forearm: number;
}

/**
 * One leg and the opposite arm of a walker or runner at `phase` (0–1 over two steps); `side` 1
 * is half a cycle later (the other leg). Walking swings moderately with an almost straight leg;
 * running swings wide, folds the trailing knee and keeps the elbows bent.
 */
export function limbAngles(phase: number, running: boolean, side: 0 | 1): LimbPose {
  'worklet';
  const swing = Math.sin(2 * Math.PI * phase + side * Math.PI);
  const back = Math.max(0, -swing);
  if (!running) {
    return { thigh: -26 * swing, shin: 14 * back, arm: 22 * swing, forearm: -12 };
  }
  return { thigh: -42 * swing, shin: 20 + 60 * back, arm: 38 * swing, forearm: -85 };
}

/** The drawn bike: hip on the saddle, crank in the middle (28 × 28 grid). */
const HIP = { x: 11, y: 13 };
const CRANK = { x: 14, y: 21 };
const CRANK_RADIUS = 3;
/** Thigh and shin length: long enough to reach the pedal at its farthest (|hip–crank| + radius). */
export const PEDAL_SEGMENT = 5.9;

/**
 * A cyclist's leg following its pedal round (`side` 1: the other pedal, half a turn on): the
 * foot is placed on the pedal and the knee found from the two equal leg segments (law of
 * cosines), always bending forwards.
 */
export function pedalLeg(phase: number, side: 0 | 1): { thigh: number; shin: number } {
  'worklet';
  const angle = 2 * Math.PI * phase + side * Math.PI;
  const dx = CRANK.x + CRANK_RADIUS * Math.cos(angle) - HIP.x;
  const dy = CRANK.y + CRANK_RADIUS * Math.sin(angle) - HIP.y;
  const reach = Math.min(Math.hypot(dx, dy), 2 * PEDAL_SEGMENT - 0.01);
  const toFoot = (Math.atan2(dx, dy) * 180) / Math.PI;
  const bend = (Math.acos(reach / (2 * PEDAL_SEGMENT)) * 180) / Math.PI;
  return { thigh: -(toFoot + bend), shin: 2 * bend };
}
