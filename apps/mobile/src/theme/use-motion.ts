import {
  FadeIn,
  FadeInDown,
  FadeInUp,
  FadeOut,
  FadeOutDown,
  FadeOutUp,
  ReduceMotion,
  useReducedMotion,
  ZoomIn,
} from 'react-native-reanimated';

import { choreography, duration, spring } from './motion';

/**
 * Entering/exiting animations that respect Reduce Motion (BARGU_PLAN §4.1): with it on, things
 * fade in place instead of moving or bouncing.
 */
export function useMotion() {
  const reduced = useReducedMotion();
  const fade = FadeIn.duration(duration.fast);
  const springy = <
    T extends { damping: (v: number) => T; stiffness: (v: number) => T; mass: (v: number) => T },
  >(
    builder: T,
    config: { damping: number; stiffness: number; mass: number },
  ) => builder.damping(config.damping).stiffness(config.stiffness).mass(config.mass);

  return {
    reduced,
    /** Content arriving from below (cards, toasts, list items). */
    enterUp: reduced
      ? fade
      : springy(FadeInDown.springify(), spring.snappy).reduceMotion(ReduceMotion.System),
    /** The n-th element of a group, entering after the ones before it. */
    enterUpAt: (index: number) =>
      reduced
        ? fade
        : springy(FadeInDown.springify(), spring.snappy)
            .delay(index * choreography.stagger)
            .reduceMotion(ReduceMotion.System),
    /** Content arriving from above (top bars, toasts). */
    enterDown: reduced
      ? fade
      : springy(FadeInUp.springify(), spring.bouncy).reduceMotion(ReduceMotion.System),
    exitUp: reduced
      ? FadeOut.duration(duration.fast)
      : FadeOutUp.duration(duration.fast).reduceMotion(ReduceMotion.System),
    exitDown: reduced
      ? FadeOut.duration(duration.fast)
      : FadeOutDown.duration(duration.fast).reduceMotion(ReduceMotion.System),
    /** Something small appearing with a playful bounce (status icons, previews). */
    pop: reduced
      ? fade
      : springy(ZoomIn.springify(), spring.bouncy).reduceMotion(ReduceMotion.System),
    /** The n-th of many small pieces popping in quickly one after another (digit groups). */
    popAt: (index: number) =>
      reduced
        ? fade
        : springy(ZoomIn.springify(), spring.bouncy)
            .delay(index * choreography.digitStagger)
            .reduceMotion(ReduceMotion.System),
    fadeIn: FadeIn.duration(duration.base),
    fadeOut: FadeOut.duration(duration.fast),
  };
}
