import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { activityFx } from '@/theme';

/** Where the first print is drawn behind the person's position (px). */
const START = 6;
/** Prints turn slightly outwards, like feet. */
const TOE_OUT = 10;

function Print({
  index,
  count,
  phase,
  spacing,
  side,
  center,
  color,
}: {
  index: number;
  count: number;
  phase: SharedValue<number>;
  spacing: number;
  side: number;
  center: number;
  color: string;
}) {
  const { width, height, opacity } = activityFx.footprints;
  const style = useAnimatedStyle(() => {
    const p = phase.get();
    // Over one step the prints slide back by one place and the newest one appears at the front;
    // left and right alternate, each print keeping its side as it slides.
    const step = (p * 2) % 1;
    const parity = p < 0.5 ? 0 : 1;
    const position = index + step;
    const foot = (index + parity) % 2 === 0 ? -1 : 1;
    const fadeIn = Math.min(1, position / 0.4);
    return {
      opacity: opacity * fadeIn * Math.max(0, 1 - position / count),
      transform: [
        { translateX: foot * side },
        { translateY: START + position * spacing },
        { rotate: `${String(foot * TOE_OUT)}deg` },
      ],
    };
  });
  return (
    <Animated.View
      style={[
        styles.print,
        {
          left: center - width / 2,
          top: center - height / 2,
          width,
          height,
          borderRadius: width / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  );
}

/**
 * Footprints behind someone walking or running, in their colour: a new one appears with every
 * step, left and right in turn, and the older ones slide back and fade. Drawn in the marker's own
 * box, turned towards their heading. With Reduce Motion they stay still.
 */
export function Footprints({
  gait,
  heading,
  center,
  color,
}: {
  gait: 'walk' | 'run';
  heading: number;
  /** The person's position inside the marker box (its centre). */
  center: number;
  color: string;
}) {
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  const { prints, spacing, side } = activityFx.footprints[gait];
  const cycleMs = activityFx[gait].cycleMs;

  useEffect(() => {
    cancelAnimation(phase);
    phase.set(0);
    if (reduced) return;
    phase.set(withRepeat(withTiming(1, { duration: cycleMs, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(phase);
    };
  }, [phase, reduced, cycleMs]);

  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { transform: [{ rotate: `${String(heading)}deg` }] }]}
    >
      {Array.from({ length: prints }, (_, index) => (
        <Print
          key={index}
          index={index}
          count={prints}
          phase={phase}
          spacing={spacing}
          side={side}
          center={center}
          color={color}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({ print: { position: 'absolute' } });
