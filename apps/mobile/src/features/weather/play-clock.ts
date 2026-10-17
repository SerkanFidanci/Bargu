import { useEffect } from 'react';
import {
  cancelAnimation,
  Easing,
  type SharedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { weatherFx } from '@/theme';
import type { EffectLevel } from '@/theme/effects';

/**
 * The weather's clock in ms (docs/ADR/0027). At sade mod "full" it runs for weatherFx.play.ms from
 * each `play` key (the map opened, the weather changed, a touch or a move), in steps of at most 30
 * a second, then stops: the drawing holds its last frame and nothing more is computed. Below
 * "full" it stands still: one still frame. Never an endless clock.
 */
export function usePlayClock(level: EffectLevel, play: string): SharedValue<number> {
  const clock = useSharedValue(0);
  useEffect(() => {
    if (level !== 'full') {
      cancelAnimation(clock);
      return;
    }
    const { ms, steps } = weatherFx.play;
    clock.set(withTiming(clock.get() + ms, { duration: ms, easing: Easing.steps(steps, true) }));
    return () => {
      cancelAnimation(clock);
    };
  }, [level, play, clock]);
  return clock;
}
