import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedProps, useSharedValue, withTiming } from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { remainingShare } from '@/features/circles/event-time';
import { timing, useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The countdown ring of an event circle (BARGU_PLAN §4.3 "geri sayım halkası"): the share of the
 * event still ahead. It steps down gently with the screen's clock (`now`, every half minute) and is
 * still in between: one animation all the way to the end, up to a week, drew frames the whole time
 * the screen was open (QA Faz 8 D9, battery). With Reduce Motion each step is a jump.
 */
export function CountdownRing({
  startedAt,
  expiresAt,
  now,
  size,
  stroke,
  children,
}: {
  startedAt: number;
  expiresAt: number;
  /** The screen's clock (useNow): the starting point after every re-render. */
  now: number;
  size: number;
  stroke: number;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const share = useSharedValue(remainingShare(startedAt, expiresAt, now));
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;

  useEffect(() => {
    share.set(withTiming(remainingShare(startedAt, expiresAt, now), timing.slow));
  }, [startedAt, expiresAt, now, share]);

  const arc = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - share.get()) }));
  const center = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.primarySoft}
          strokeWidth={stroke}
          fill="none"
        />
        <AnimatedCircle
          cx={center}
          cy={center}
          r={radius}
          stroke={colors.primary}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={length}
          fill="none"
          // From twelve o'clock, emptying clockwise.
          transform={`rotate(-90 ${String(center)} ${String(center)})`}
          animatedProps={arc}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.center]}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({ center: { alignItems: 'center', justifyContent: 'center' } });
