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
export const duration = { fast: 150, base: 250, slow: 400 } as const;

export const timing = {
  fast: { duration: duration.fast, reduceMotion: ReduceMotion.System },
  base: { duration: duration.base, reduceMotion: ReduceMotion.System },
  slow: { duration: duration.slow, reduceMotion: ReduceMotion.System },
} as const satisfies Record<string, WithTimingConfig>;

/**
 * Ambient loops (not user-triggered, so not bound by the 400 ms rule): avatars "breathe" on the
 * map and skeletons pulse while loading. Both stop entirely with Reduce Motion.
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
