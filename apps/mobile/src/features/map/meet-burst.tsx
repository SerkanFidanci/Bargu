import { Canvas, Points, type SkPoint } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import {
  Easing,
  ReduceMotion,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { meetFx } from '@/theme';

function seed(n: number): number {
  'worklet';
  const x = Math.sin(n * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

/**
 * Particles bursting out of a point and fading (Skia, UI thread). Two colours: the two people
 * who met. Plays once each time `at` changes; nothing with Reduce Motion.
 */
export function MeetBurst({ at, colors }: { at: number; colors: readonly [string, string] }) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(1);
  const size = meetFx.reach * 2 + meetFx.size * 2;
  const center = size / 2;

  useEffect(() => {
    progress.set(0);
    progress.set(
      withTiming(1, {
        duration: meetFx.durationMs,
        easing: Easing.out(Easing.cubic),
        reduceMotion: ReduceMotion.System,
      }),
    );
  }, [at, progress]);

  const half = (offset: number) => () => {
    'worklet';
    const t = progress.get();
    const points: SkPoint[] = [];
    for (let i = offset; i < meetFx.particles; i += 2) {
      const angle = (i / meetFx.particles) * 2 * Math.PI + seed(i) * 0.4;
      const reach = meetFx.reach * t * (0.55 + 0.45 * seed(i + 0.5));
      points.push({ x: center + Math.cos(angle) * reach, y: center + Math.sin(angle) * reach });
    }
    return points;
  };
  const first = useDerivedValue(half(0));
  const second = useDerivedValue(half(1));
  const opacity = useDerivedValue(() => (progress.get() >= 1 ? 0 : 1 - progress.get()));

  if (reduced) return null;
  return (
    <View
      pointerEvents="none"
      style={[styles.burst, { width: size, height: size, marginLeft: -center, marginTop: -center }]}
    >
      <Canvas style={StyleSheet.absoluteFill}>
        <Points
          points={first}
          mode="points"
          strokeWidth={meetFx.size}
          strokeCap="round"
          color={colors[0]}
          opacity={opacity}
        />
        <Points
          points={second}
          mode="points"
          strokeWidth={meetFx.size}
          strokeCap="round"
          color={colors[1]}
          opacity={opacity}
        />
      </Canvas>
    </View>
  );
}

const styles = StyleSheet.create({
  burst: { position: 'absolute', left: '50%', top: '50%' },
});
