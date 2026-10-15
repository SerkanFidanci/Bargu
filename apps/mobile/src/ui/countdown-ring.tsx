import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import { remainingShare } from '@/features/circles/event-time';
import { useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * The countdown ring of an event circle (BARGU_PLAN §4.3 "geri sayım halkası"): the share of the
 * event still ahead, emptying on the UI thread all the way to its end. With Reduce Motion it stays
 * still and catches up whenever the screen re-renders (`now`).
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
  const reduced = useReducedMotion();
  const share = useSharedValue(remainingShare(startedAt, expiresAt, now));
  const radius = (size - stroke) / 2;
  const length = 2 * Math.PI * radius;

  useEffect(() => {
    const at = Date.now();
    cancelAnimation(share);
    share.set(remainingShare(startedAt, expiresAt, at));
    if (reduced || expiresAt <= at) return;
    share.set(withTiming(0, { duration: expiresAt - at, easing: Easing.linear }));
    return () => {
      cancelAnimation(share);
    };
  }, [startedAt, expiresAt, now, reduced, share]);

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
