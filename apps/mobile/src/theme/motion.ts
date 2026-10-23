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
 * People gliding on the map between two locations (BARGU_PLAN §3.3 receiver, docs/ADR/0028): from
 * where the pin is to the new location, over about the time since the previous one, so at a steady
 * rate it never stands still. A guess ahead only on a straight, steady, well measured course, and
 * never more than `leadMs` past the location (the PM): no pin runs off a winding road.
 */
export const glide = {
  /** The glide lasts the gap between the two locations times this… */
  spanFactor: 1.1,
  /** …but not less than this… */
  minSpanMs: 250,
  /** …nor more (after a long gap: get there, do not crawl). */
  maxSpanMs: 2_000,
  /** A guess ahead goes at most this far past the location in time… */
  leadMs: 1_000,
  /** …only faster than this (m/s)… */
  leadSpeed: 2,
  /** …heading within this many degrees of the location before (no guess on a bend)… */
  leadTurnDeg: 20,
  /** …and measured at least this precisely (m). */
  leadAccuracyM: 20,
  /** Below this speed (m/s) a person counts as still: eased into place, no trail. */
  movingSpeed: 1,
  /** A location this long after the previous one is placed, not glided to. */
  jumpGapMs: 30_000,
  /** Farther than this (m) from where the pin is: placed, not glided across town. */
  teleportM: 500,
  /** A location less precise than this (m) shows a circle of where they may be, and no guess… */
  roughAccuracyM: 100,
  /** …unless it is a neighbourhood or city cell (1 km or more, precision.ts): those show none. */
  cellAccuracyM: 700,
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
 * A crowd on the map (the owner's 50-person test, 2026-10-23: the map stuttered). Every pin is a
 * view of its own over the map; each loop it plays redraws it every frame. With more people than
 * `calmAbove` drawn, pins hold still (no breath, no steps, no low-battery pulse); with more than
 * `stillAbove`, they also stop gliding and jump to each new spot.
 */
export const crowdFx = { calmAbove: 12, stillAbove: 25 } as const;

/**
 * A poke with a feeling on the screen of whom it is for (docs/ADR/0031): how long it plays (shorter
 * at "Az"), the pieces flying out and how far, the big one in the middle, the shake of an angry
 * one, the glow at the edges of a hug or an angry one, and how long a question waits for an answer.
 */
export const pokeFx = {
  durationMs: 1_600,
  reducedMs: 800,
  pieces: 14,
  spread: 170,
  rise: 360,
  big: 112,
  small: 34,
  shake: { px: 12, times: 5 },
  glow: 0.4,
  edge: 56,
  questionHoldMs: 12_000,
  replyHoldMs: 4_000,
} as const;

/**
 * How a person's avatar moves with what they are doing (features/map/activity.ts): a step bob when
 * walking, a quicker bounce and a lean when running, a sway on a bike, a light engine shake in a
 * car, and a slow ripple when they have stayed in one place for a while. Periods in ms, distances
 * in px, angles in degrees.
 */
export const activityFx = {
  /**
   * From these speeds (m/s): walking, running, cycling, driving; then a fast car (120 km/h), a
   * high-speed train (200 km/h) and a plane (300 km/h). Only a sender who shows their speed, at the
   * exact location, carries one (the owner, 2026-10-21, with the PM's guardrails).
   */
  speeds: {
    walk: 0.8,
    run: 2.2,
    bike: 4.2,
    drive: 8,
    race: 120 / 3.6,
    train: 200 / 3.6,
    plane: 300 / 3.6,
  },
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
  /**
   * In a vehicle (car, fast car, train, plane): one cycle a second. The pin hums `bobs` times a
   * cycle; the wheels turn about `turnsPerKmh` × the speed in km/h times a second (1 to
   * `maxTurns`), too fast to see the spokes from `blurTurns`; the road passes `dashesPerKmh` ×
   * the speed dashes a second. Below `smokeBelow` (m/s, in town) smoke drifts back, from there
   * the air streams past.
   */
  drive: {
    periodMs: 1_000,
    lift: 0.8,
    bobs: 3,
    turnsPerKmh: 1 / 22,
    maxTurns: 9,
    blurTurns: 4,
    dashesPerKmh: 1 / 20,
    maxDashes: 10,
    smokeBelow: 70 / 3.6,
  },
  settled: { rippleMs: 3_200, scale: 1.9, opacity: 0.35 },
} as const;

/**
 * A person on the map as a pin (the project owner, 2026-10-18, in place of the sticker and its
 * island): their avatar in a ring, a short tail down to a dot on the exact position, a green dot
 * while the location is fresh. Sizes in px.
 */
export const pinFx = {
  /** The ring around the avatar. */
  ring: 3,
  /** From the circle's lower edge to the exact position. */
  tail: 9,
  /** The tail's width where it meets the circle. */
  tailWidth: 14,
  /** The dot on the exact position. */
  dot: 8,
  /** The green "live" dot on the circle's lower right. */
  live: 12,
  /** While live and still the pin floats up this far. */
  float: { lift: 2.5 },
  /** Side by side in a shared pin: the gap between avatars. */
  together: { gap: 6 },
} as const;

/**
 * Looks on the map pin (features/cosmetics, docs/ADR/0025 and its addendum of 2026-10-21): a
 * pattern on the pin's ring and a frame around it. Sizes in px, periods in ms. The still styles
 * (stripes, dots, gradient, gold, dashed) cost nothing; the moving ones (sparkle, holo, neon) play
 * at sade mod "full" only, never for an old location, and on at most `maxAnimated` pins at a time.
 */
export const cosmeticFx = {
  /** A ring pattern is drawn over the pin's ring, this wide. */
  ringWidth: 5,
  /** A frame is this wide and this far outside the ring. */
  frame: { width: 3, gap: 2 },
  /** Segments of the striped ring, dots of the dotted ring, sparkles on the sparkling one. */
  stripes: 24,
  dots: 12,
  sparkles: { count: 8, size: 5 },
  /** The dashed frame: the dash and the gap between dashes. */
  dash: { length: 6, gap: 4 },
  /** The glow of a neon frame, outwards from the pin: how far past the frame it reaches, how faint. */
  glow: [
    { reach: 3, opacity: 0.3 },
    { reach: 6, opacity: 0.14 },
  ],
  /** An old location shows its look this faint. */
  staleOpacity: 0.45,
  /** How many pins on the map move their look at once; the user's own pin always may. */
  maxAnimated: 3,
  /** Sparkles twinkle in two groups taking turns: one twinkle takes this long, to this dimmest. */
  sparkle: { periodMs: 1_800, dimmest: 0.25 },
  /** The holographic frame turns once in this long. */
  holo: { periodMs: 6_000 },
  /** The neon frame breathes in and out once in this long, to this dimmest glow. */
  neon: { periodMs: 1_400, dimmest: 0.4 },
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
