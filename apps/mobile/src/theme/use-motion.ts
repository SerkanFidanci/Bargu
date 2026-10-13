import {
  FadeIn,
  FadeInDown,
  FadeOut,
  FadeOutDown,
  ReduceMotion,
  useReducedMotion,
} from 'react-native-reanimated';

import { duration, spring } from './motion';

/**
 * Entering/exiting animations that respect Reduce Motion (BARGU_PLAN §4.1): with it on, things
 * fade in place instead of moving or bouncing.
 */
export function useMotion() {
  const reduced = useReducedMotion();
  return {
    reduced,
    /** Content arriving from below (cards, toasts, list items). */
    enterUp: reduced
      ? FadeIn.duration(duration.fast)
      : FadeInDown.springify()
          .damping(spring.snappy.damping)
          .stiffness(spring.snappy.stiffness)
          .mass(spring.snappy.mass)
          .reduceMotion(ReduceMotion.System),
    exitDown: reduced
      ? FadeOut.duration(duration.fast)
      : FadeOutDown.duration(duration.fast).reduceMotion(ReduceMotion.System),
    fadeIn: FadeIn.duration(duration.base),
    fadeOut: FadeOut.duration(duration.fast),
  };
}
