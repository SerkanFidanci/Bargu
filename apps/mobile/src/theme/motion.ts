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
} as const;

/** Haptic feedback per interaction kind (expo-haptics), see haptics.ts. */
export const haptic = { select: 'selection', success: 'success', bump: 'heavy' } as const;
export type HapticKind = keyof typeof haptic;

/** Press feedback: how far a pressed control shrinks and dims. */
export const press = { scale: 0.96, opacity: 0.85 } as const;

/** Debounce for live checks while typing (username availability). */
export const typingDebounceMs = 350;
