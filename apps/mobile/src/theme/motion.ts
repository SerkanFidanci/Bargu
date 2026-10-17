import {
  ReduceMotion,
  type WithSpringConfig,
  type WithTimingConfig,
} from 'react-native-reanimated';

/**
 * Motion tokens (BARGU_PLAN §4.2, docs/MOTION.md). The only place animation numbers live: ESLint
 * rejects literal springs and durations anywhere else. Every config follows the system Reduce
 * Motion setting; components that move things also swap to a fade (see use-motion.ts).
 */
export const spring = {
  snappy: { damping: 20, stiffness: 300, mass: 0.8, reduceMotion: ReduceMotion.System },
  bouncy: { damping: 12, stiffness: 180, mass: 1, reduceMotion: ReduceMotion.System },
  gentle: { damping: 26, stiffness: 120, mass: 1, reduceMotion: ReduceMotion.System },
} as const satisfies Record<string, WithSpringConfig>;

/** Milliseconds. Nothing keeps the user waiting longer than `slow` (BARGU_PLAN §4.1). */
/** `instant`: no motion at all (sade mod "off"), where an animation must still be named. */
export const duration = { instant: 0, fast: 150, base: 250, slow: 400 } as const;

export const timing = {
  fast: { duration: duration.fast, reduceMotion: ReduceMotion.System },
  base: { duration: duration.base, reduceMotion: ReduceMotion.System },
  slow: { duration: duration.slow, reduceMotion: ReduceMotion.System },
} as const satisfies Record<string, WithTimingConfig>;

/**
 * Ambient loops (not user-triggered, so not bound by the 400 ms rule): avatars "breathe" on the
 * map and skeletons pulse while loading. Both stop below sade mod "full" and with Reduce Motion.
 */
export const ambient = {
  breathe: { duration: 2400, scale: 1.04 },
  pulse: { duration: 900, minOpacity: 0.45 },
  /** Onboarding illustrations: how long each state holds before the next one. */
  illustrationHold: 1400,
  /** Ghost / visible cross-fade in the onboarding illustration. */
  ghostFade: 1200,
  /** How long the map data credit stays before it folds away (OSM attribution guidelines). */
  mapCredit: 5000,
  /** Light sweeping across a primary button when pressed. */
  shine: 650,
  /** Empty-state icons bob gently. */
  float: { duration: 2200, distance: 4 },
  /** Celebration when onboarding completes (over the map, never blocking it). */
  confetti: { duration: 1600, count: 18, rise: 260, spread: 300 },
  /** How long a short inline notice stays before it goes (e.g. "not a Bargu code"). */
  noticeHold: 1600,
  /** The line sweeping over the QR scanner's frame, top to bottom and back. */
  scanLine: 1800,
  /** A QR code's halo slowly grows and fades, inviting the other phone to scan it. */
  qrHalo: { duration: 2000, scale: 1.08 },
} as const;

/**
 * People gliding on the map between two locations (BARGU_PLAN §3.3 receiver). Someone moving is
 * carried on along their heading at their speed until about when the next location is due, never
 * more than `maxAheadMs` past the last one (dead reckoning); someone still settles into place.
 */
export const glide = {
  /** A still person (or one without speed and heading) moves to the new spot this fast. */
  settle: duration.slow,
  /** How far ahead of the last location a moving person is extrapolated, at most. */
  maxAheadMs: 10_000,
  /** Expected gap between two locations until the real one is known (send.ts: 5 s moving). */
  defaultIntervalMs: 5_000,
  /** Live mode sends about every second: no gap is assumed shorter than this. */
  minIntervalMs: 900,
  /** Below this speed (m/s) a person counts as still: no extrapolation, no trail. */
  movingSpeed: 1,
  /** Farther than this (m) from where the avatar is shown: jump, do not glide across the city. */
  teleportM: 2_000,
  /** Speeds (m/s) from which the trail grows: walking, cycling or running, in a vehicle. */
  trailSpeeds: [1, 3, 8],
} as const;

/**
 * The login code (ui/code-input.tsx): with the last digit the boxes curl onto an orbit, circle it
 * while the server checks the code (the orbit is the loading state), and on success screw down a
 * turn and a quarter into one verified tile. A wrong code unwinds them back into the row.
 */
export const orbit = {
  curl: duration.base,
  /** One full turn while waiting for the server. */
  turn: 900,
  screw: duration.slow,
  /** Turns made while screwing down into the tile. */
  screwTurns: 1.25,
  /** How long a wrong code stays red before the boxes empty for another try. */
  errorHold: 900,
  /** Boxes shrink to this on the orbit, and the ring is dotted (dash, gap) so it does not read as a spinner. */
  orbitScale: 0.72,
  ringDash: [2, 8],
} as const;

/**
 * Weather over the map (features/weather, docs/ADR/0013): ambient, never in the way. Counts are at
 * full intensity; lighter weather draws fewer. Times are one fall / drift / flash cycle.
 */
export const weatherFx = {
  rain: { drops: 70, fallMs: 650, length: 18, tilt: 0.25 },
  drizzle: { drops: 40, fallMs: 1_000, length: 9, tilt: 0.12 },
  snow: { flakes: 55, fallMs: 9_000, sway: 16, size: 3.5 },
  fog: { bands: 3, driftMs: 26_000, opacity: 0.32 },
  clouds: { puffs: 4, driftMs: 45_000, opacity: 0.16 },
  /** Lightning: one flash per cycle, this long, at this brightness. */
  flash: { everyMs: 6_500, ms: 160, opacity: 0.55 },
  sun: { pulseMs: 5_000, opacity: 0.32 },
  stars: { count: 18, twinkleMs: 3_200 },
  /**
   * At sade mod "full" the weather plays this long (the map opened, the weather changed, a touch
   * or a move), in this many steps (30 a second), then holds its last frame (docs/ADR/0027).
   */
  play: { ms: 20_000, steps: 600 },
} as const;

/** "You met": a burst of particles around the user's avatar (BARGU_PLAN §4.3). */
export const meetFx = { particles: 28, durationMs: 1_400, reach: 72, size: 5 } as const;

/**
 * How a person's avatar moves with what they are doing (features/map/activity.ts): a step bob when
 * walking, a quicker bounce and a lean when running, a sway on a bike, a light engine shake in a
 * car, and a slow ripple when they have stayed in one place for a while. Periods in ms, distances
 * in px, angles in degrees.
 */
export const activityFx = {
  /** From these speeds (m/s): walking, running, cycling, driving. */
  speeds: { walk: 0.8, run: 2.2, bike: 4.2, drive: 8 },
  /** Within this many metres for this long counts as staying in one place. */
  stay: { radiusM: 100, settledMin: 30 },
  /**
   * The line under someone (proje sahibi 2026-10-16): their speed from this many m/s, rounded to
   * this many km/h; while still, how long they have stayed, from this many minutes.
   */
  label: { minSpeed: 1, kmhStep: 5, minStayMin: 1 },
  /**
   * A gait: one cycle is two steps (left, right). Each step lifts the pin in a soft arc and lands
   * with a little squash; the weight shifts side to side once per cycle (pivoting on the point
   * where the person is); the body leans towards where they are heading.
   */
  walk: { cycleMs: 1_040, lift: 3, sway: 1.5, tilt: 4, lean: 3, squash: 0.06 },
  run: { cycleMs: 680, lift: 5.5, sway: 1, tilt: 3, lean: 8, squash: 0.1 },
  /** Footprints left behind while walking or running: count, spacing and side offset (px). */
  footprints: {
    walk: { prints: 5, spacing: 9, side: 3.5 },
    run: { prints: 4, spacing: 14, side: 3 },
    width: 4.5,
    height: 7,
    opacity: 0.55,
  },
  /** The shadow under a walking or running pin: smaller and lighter while it is in the air. */
  shadow: { width: 22, height: 6, opacity: 0.6, shrink: 0.35 },
  bike: { periodMs: 760, tilt: 7, sway: 1.5 },
  drive: { periodMs: 140, lift: 0.8 },
  settled: { rippleMs: 3_200, scale: 1.9, opacity: 0.35 },
} as const;

/**
 * People on the map as stickers stuck above their spot (proje sahibi 2026-10-16: "sıradan bir şey
 * yapma"): a thick white die-cut edge, each person tilted their own way, and under them a small
 * island in their colour on the exact position. Together, their islands flow into one and the
 * stickers line up side by side (features/map/cluster-bubble.tsx).
 */
export const stickerFx = {
  /** The white edge around the avatar (px). */
  edge: 5,
  /** Each person's own tilt (degrees, either way), from their id: never upright. */
  tilt: { min: 3, max: 8 },
  /** From the sticker's lower edge to the island's centre, the exact position (px). */
  rise: 7,
  /** The island: an ellipse in their colour, with a solid core on the exact point (px). */
  island: { width: 30, height: 10, core: 7, opacity: 0.32 },
  /** While live and still the sticker floats up this far (px), its island shrinking this share. */
  float: { lift: 2.5, shrink: 0.12 },
  /** Side by side when together: the gap between stickers (px), and how wide each island grows. */
  together: { gap: 6, islandGrow: 2.1, islandTall: 1.3 },
} as const;

/** Sequencing of several elements: how they enter one after another and how they react. */
export const choreography = {
  /** Delay between consecutive elements entering (titles, fields, rows). */
  stagger: 60,
  /** A filled code box or chosen swatch briefly grows to this scale. */
  pop: 1.14,
  /** Wrong code: the boxes shake sideways this far, this many times. */
  shake: { distance: 8, step: 45, times: 3 },
  /** Intro cards: how much slower than the swipe each layer moves (0 = with the page). */
  parallax: { illustration: 0.45, text: 0.15 },
  /** The dock's add button turns into a close cross while its sheet is open. */
  addTurn: 45,
  /** Safety number groups appear one after another, faster than rows. */
  digitStagger: 35,
  /** Holding a person on the map this long opens the radial menu (BARGU_PLAN §4.3). */
  hold: 350,
  /** Radial menu items pop out one after another, quicker than rows. */
  radialStagger: 30,
} as const;

/**
 * The map's shortcuts and meeting chip (docs/ADR/0026 §8): short, one-off effects, never an endless
 * loop (battery). Counts are for the full level of sade mod; "reduced" plays one, "off" none.
 */
export const shortcutFx = {
  /** Ghost mode on: the ghost floats up and down this many times, then rests. */
  ghostFloats: 3,
  /** Ghost mode off: a little "pof", squeezed then past its size. */
  pof: { squeeze: 0.72, overshoot: 1.14 },
  /** "Back to me": one ring spreading from the button, the icon turning once. */
  radar: { duration: 700, scale: 2.4, opacity: 0.6 },
  /** "Geldim" appearing: this many rings, then still; one more when the chip's minute changes. */
  hereRings: 3,
  ring: { duration: 1200, scale: 2.2, opacity: 0.5 },
  /** The meeting chip's last stretch: this many breaths as it starts, then still. */
  chipBreaths: 3,
  /** A changed minute rolls in from below. */
  roll: { duration: 280, distance: 12 },
} as const;

/** Haptic feedback per interaction kind (expo-haptics), see haptics.ts. */
export const haptic = {
  select: 'selection',
  success: 'success',
  error: 'error',
  bump: 'heavy',
} as const;
export type HapticKind = keyof typeof haptic;

/** Press feedback: how far a pressed control shrinks and dims. */
export const press = { scale: 0.96, opacity: 0.85 } as const;

/** Debounce for live checks while typing (username availability). */
export const typingDebounceMs = 350;
