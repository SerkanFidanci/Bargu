import { create } from 'qrcode';
import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Path } from 'react-native-svg';

import { ambient, elevation, qrColors, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';

/** Light modules around the code (the "quiet zone" scanners need), in modules. */
const QUIET_ZONE = 2;

/** One SVG path for all dark modules: a run of dark cells in a row becomes one rectangle. */
export function qrPath(text: string): { size: number; path: string } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const parts: string[] = [];
  for (let row = 0; row < modules.size; row++) {
    let start = -1;
    for (let col = 0; col <= modules.size; col++) {
      const dark = col < modules.size && modules.get(row, col) === 1;
      if (dark && start === -1) start = col;
      if (!dark && start !== -1) {
        parts.push(
          `M${String(start)} ${String(row)}h${String(col - start)}v1h${String(start - col)}z`,
        );
        start = -1;
      }
    }
  }
  return { size: modules.size, path: parts.join('') };
}

export interface QrCodeProps {
  value: string;
  /** Rendered width and height. */
  size: number;
  /** What the code is, for screen readers (they cannot read the code itself). */
  label: string;
}

/**
 * A QR code on a white card with a slowly breathing halo behind it, popping in when it appears.
 * Always dark on white, whatever the theme (scanners need the contrast).
 */
export function QrCode({ value, size, label }: QrCodeProps) {
  const { colors } = useTheme();
  const motion = useMotion();
  const reduced = useReducedMotion();
  const { size: modules, path } = useMemo(() => qrPath(value), [value]);
  const halo = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    halo.set(
      withRepeat(
        withTiming(1, { duration: ambient.qrHalo.duration, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      ),
    );
  }, [halo, reduced]);

  const haloStyle = useAnimatedStyle(() => ({
    opacity: 0.35 * (1 - halo.get()),
    transform: [{ scale: 1 + (ambient.qrHalo.scale - 1) * halo.get() }],
  }));

  const box = modules + QUIET_ZONE * 2;
  return (
    <Animated.View entering={motion.pop} style={styles.wrap}>
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          styles.halo,
          { backgroundColor: colors.primary },
          haloStyle,
        ]}
      />
      <View
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        style={[styles.card, { backgroundColor: qrColors.light, boxShadow: elevation.floating }]}
      >
        <Svg
          width={size}
          height={size}
          viewBox={`${String(-QUIET_ZONE)} ${String(-QUIET_ZONE)} ${String(box)} ${String(box)}`}
        >
          <Path d={path} fill={qrColors.dark} />
        </Svg>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'center', padding: space.sm },
  halo: { borderRadius: radius.xl },
  card: { padding: space.md, borderRadius: radius.lg },
});
