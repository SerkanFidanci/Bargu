/** What the activity drawing shows (still people get none). */
export type GlyphActivity =
  'walking' | 'running' | 'cycling' | 'driving' | 'racing' | 'train' | 'plane' | 'settled';

/**
 * A walker or runner drawn on a 48 × 48 grid facing right (the owner's approved preview,
 * 2026-10-21): limbs of these lengths, the hip here, the feet on this ground line.
 */
export const FIGURE = {
  walk: { thigh: 9.6, shin: 9.4, arm: 7.4, fore: 6.8, torso: 12, lean: 4 },
  run: { thigh: 9.2, shin: 9.2, arm: 7, fore: 6.4, torso: 11.5, lean: 13 },
  hip: { x: 23.5, y: 26 },
  ground: 44.2,
} as const;

/**
 * One limb pair's angles in degrees from straight down, forward (to the right) positive: the
 * thigh, and how far the knee folds the shin back; the upper arm, and how far the elbow bends the
 * forearm forward.
 */
export interface StridePose {
  near: { thigh: number; knee: number };
  far: { thigh: number; knee: number };
  nearArm: { arm: number; fore: number };
  farArm: { arm: number; fore: number };
  /** How far the whole figure moves down (grid units) so the lower foot stands on the ground. */
  dy: number;
}

/** 1 at `center`, falling to 0 at `width` either side. */
function bump(p: number, center: number, width: number): number {
  'worklet';
  return Math.max(0, 1 - ((p - center) / width) ** 2);
}

function leg(p: number, running: boolean): { thigh: number; knee: number } {
  'worklet';
  if (!running) {
    return {
      thigh: 24 * Math.cos(2 * Math.PI * p),
      knee: 4 + 48 * bump(p, 0.68, 0.2) + 10 * bump(p, 0.1, 0.12),
    };
  }
  return {
    thigh: 12 + 40 * Math.cos(2 * Math.PI * p),
    knee: 22 + 92 * bump(p, 0.7, 0.24) + 18 * bump(p, 0.15, 0.12),
  };
}

function arm(p: number, running: boolean): { arm: number; fore: number } {
  'worklet';
  return {
    arm: (running ? -34 : -20) * Math.cos(2 * Math.PI * p),
    fore: running ? 88 : 18 + 10 * Math.max(0, -Math.cos(2 * Math.PI * p)),
  };
}

/** Where a leg hanging from the hip ends, from its angles (grid units, from the hip). */
export function footOf(
  pose: { thigh: number; knee: number },
  length: { thigh: number; shin: number },
) {
  'worklet';
  const rad = Math.PI / 180;
  const shin = pose.thigh - pose.knee;
  return {
    x: length.thigh * Math.sin(pose.thigh * rad) + length.shin * Math.sin(shin * rad),
    y: length.thigh * Math.cos(pose.thigh * rad) + length.shin * Math.cos(shin * rad),
  };
}

/**
 * A walker or runner at `phase` (0–1 over two steps): legs in turn, each arm against its leg, the
 * swinging knee folding, the runner leaning and both feet off the ground for a moment. The figure
 * is lowered so the lower foot stands on the ground, which gives the body its natural rise and fall.
 */
export function stridePose(phase: number, running: boolean): StridePose {
  'worklet';
  const p = phase - Math.floor(phase);
  const other = (p + 0.5) % 1;
  const length = running ? FIGURE.run : FIGURE.walk;
  const near = leg(p, running);
  const far = leg(other, running);
  const lowest = Math.max(footOf(near, length).y, footOf(far, length).y);
  const flight = running ? 2.2 * Math.max(0, Math.sin(4 * Math.PI * (p - 0.12))) : 0;
  return {
    near,
    far,
    nearArm: arm(p, running),
    farArm: arm(other, running),
    dy: FIGURE.ground - FIGURE.hip.y - lowest - flight,
  };
}

/**
 * The bike, drawn on the vehicles' 72 × 44 grid facing right: the rider's hip on the saddle, the
 * crank round the bottom bracket, two leg segments long enough to reach the lower pedal.
 */
export const BIKE = {
  hip: { x: 24.6, y: 16.2 },
  crank: { x: 29, y: 34, radius: 4.6 },
  thigh: 11.2,
  shin: 11.4,
} as const;

/**
 * A cyclist's leg following its pedal round (`side` 1: the other pedal, half a turn on): the foot
 * on the pedal and the knee found from the two segments (law of cosines), always bending forward.
 * Angles from straight down, forward positive, as stridePose.
 */
export function pedalPose(phase: number, side: 0 | 1): { thigh: number; knee: number } {
  'worklet';
  const angle = 2 * Math.PI * phase + side * Math.PI;
  const dx = BIKE.crank.x + BIKE.crank.radius * Math.cos(angle) - BIKE.hip.x;
  const dy = BIKE.crank.y + BIKE.crank.radius * Math.sin(angle) - 1 - BIKE.hip.y;
  const reach = Math.min(Math.hypot(dx, dy), BIKE.thigh + BIKE.shin - 0.01);
  const toFoot = (Math.atan2(dx, dy) * 180) / Math.PI;
  const cosHip =
    (BIKE.thigh * BIKE.thigh + reach * reach - BIKE.shin * BIKE.shin) / (2 * BIKE.thigh * reach);
  const atHip = (Math.acos(Math.min(1, Math.max(-1, cosHip))) * 180) / Math.PI;
  const cosKnee =
    (BIKE.thigh * BIKE.thigh + BIKE.shin * BIKE.shin - reach * reach) /
    (2 * BIKE.thigh * BIKE.shin);
  const atKnee = (Math.acos(Math.min(1, Math.max(-1, cosKnee))) * 180) / Math.PI;
  // The knee in front of the line from hip to foot; the shin folds back by what the knee closes.
  return { thigh: toFoot + atHip, knee: 180 - atKnee };
}
