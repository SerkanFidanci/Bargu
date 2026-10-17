import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { create } from 'zustand';

import { ambient, avatarPalette, radius, space, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';

interface CelebrationState {
  pending: boolean;
  celebrate: () => void;
  done: () => void;
}

/** A one-off celebration requested by one screen (onboarding) and played by another (the map). */
export const useCelebration = create<CelebrationState>((set) => ({
  pending: false,
  celebrate: () => {
    set({ pending: true });
  },
  done: () => {
    set({ pending: false });
  },
}));

const PIECE = { width: space.sm, height: space.md };

/**
 * A short burst of confetti from the bottom of the screen. Decorative and non-blocking (touches
 * pass through); half as many pieces in sade mod "reduced", none with "off" or Reduce Motion.
 * Piece paths are fixed per index, so the burst looks the same each time and needs no randomness.
 */
export function Confetti({ onDone }: { onDone: () => void }) {
  const level = useEffects();
  const reduced = level === 'off';
  const progress = useSharedValue(0);
  const count =
    level === 'reduced' ? Math.ceil(ambient.confetti.count / 2) : ambient.confetti.count;

  useEffect(() => {
    if (reduced) {
      onDone();
      return;
    }
    progress.set(
      withTiming(
        1,
        { duration: ambient.confetti.duration, easing: Easing.out(Easing.quad) },
        (finished) => {
          if (finished === true) scheduleOnRN(onDone);
        },
      ),
    );
  }, [onDone, progress, reduced]);

  if (reduced) return null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {Array.from({ length: count }, (_, index) => (
        <Piece key={index} index={index} count={count} progress={progress} />
      ))}
    </View>
  );
}

function Piece({
  index,
  count,
  progress,
}: {
  index: number;
  count: number;
  progress: SharedValue<number>;
}) {
  const { colors } = useTheme();
  const { rise, spread } = ambient.confetti;
  // Fan out evenly; vary height, spin and colour by a fixed pattern of the index.
  const across = (index / (count - 1) - 0.5) * spread;
  const height = rise * (0.65 + ((index * 7) % 10) / 28);
  const spin = ((index * 137) % 360) + 360;
  const color =
    index % 4 === 0
      ? colors.accent
      : (avatarPalette[index % avatarPalette.length] ?? colors.primary);

  const style = useAnimatedStyle(() => {
    const p = progress.get();
    // Up, then falling back a little: a parabola over the run.
    const y = -height * (2 * p - p * p) * 1.4 + height * 0.35 * p * p;
    return {
      opacity: p < 0.75 ? 1 : (1 - p) * 4,
      transform: [
        { translateX: across * p },
        { translateY: y },
        { rotate: `${String(spin * p)}deg` },
      ],
    };
  });

  return <Animated.View style={[styles.piece, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  piece: {
    position: 'absolute',
    bottom: '22%',
    left: '50%',
    width: PIECE.width,
    height: PIECE.height,
    borderRadius: radius.sm / 4,
  },
});
