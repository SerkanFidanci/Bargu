import { useEffect } from 'react';
import type { DimensionValue } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ambient, radius, useTheme } from '@/theme';

export interface SkeletonProps {
  width: DimensionValue;
  height: number;
  round?: boolean;
}

/** Placeholder shape while content loads; pulses gently (static with Reduce Motion). */
export function Skeleton({ width, height, round = false }: SkeletonProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (reduced) return;
    pulse.set(
      withRepeat(
        withTiming(ambient.pulse.minOpacity, {
          duration: ambient.pulse.duration,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(pulse);
    };
  }, [pulse, reduced]);

  const animated = useAnimatedStyle(() => ({ opacity: pulse.get() }));
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          width,
          height,
          borderRadius: round ? height / 2 : radius.sm,
          backgroundColor: colors.surface,
        },
        animated,
      ]}
    />
  );
}
