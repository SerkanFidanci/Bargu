import type { LucideIcon } from 'lucide-react-native';
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { ambient, type ColorName, radius, space, touchTarget, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';
import type { HapticKind } from '@/theme/motion';
import { useMotion } from '@/theme/use-motion';

import { BrandFill } from './brand-fill';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const PALETTE: Record<
  ButtonVariant,
  { background: ColorName | null; text: ColorName; shine: boolean; sweep: boolean }
> = {
  // The main button wears the brand's sweep (docs/ADR/0008 Ek 2026-10-29), navy under it while it draws.
  primary: { background: 'primary', text: 'onBrand', shine: true, sweep: true },
  secondary: { background: 'surface', text: 'text', shine: false, sweep: false },
  ghost: { background: null, text: 'primary', shine: false, sweep: false },
  danger: { background: 'danger', text: 'onDanger', shine: true, sweep: false },
};

/** Width of the light band sweeping across a pressed button, relative to the button. */
const SHINE_WIDTH = 0.35;

export interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: LucideIcon;
  /** Shows a spinner and ignores presses (the label stays for screen readers). */
  loading?: boolean;
  disabled?: boolean;
  /** Stretch to the container width (default) or hug the label. */
  fill?: boolean;
  haptic?: HapticKind | undefined;
  accessibilityHint?: string;
  testID?: string;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon: Icon,
  loading = false,
  disabled = false,
  fill = true,
  haptic,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const { colors } = useTheme();
  const motion = useMotion();
  const reduced = useEffects() === 'off';
  const palette = PALETTE[variant];
  const inactive = disabled || loading;
  const textColor = colors[palette.text];
  const [width, setWidth] = useState(0);
  const shine = useSharedValue(0);

  const shineStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shine.get(), [0, 0.15, 0.85, 1], [0, 1, 1, 0]),
    transform: [
      { translateX: interpolate(shine.get(), [0, 1], [-width * SHINE_WIDTH, width]) },
      { skewX: '-20deg' },
    ],
  }));

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      onPressIn={() => {
        if (!palette.shine || reduced) return;
        shine.set(0);
        shine.set(withTiming(1, { duration: ambient.shine, easing: Easing.out(Easing.quad) }));
      }}
      disabled={inactive}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      onLayout={(event) => {
        setWidth(event.nativeEvent.layout.width);
      }}
      style={[
        styles.base,
        fill ? styles.fill : styles.hug,
        palette.background === null ? null : { backgroundColor: colors[palette.background] },
        inactive ? styles.inactive : null,
      ]}
    >
      {palette.sweep ? <BrandFill /> : null}
      {palette.shine ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.shine, { width: width * SHINE_WIDTH }, shineStyle]}
        />
      ) : null}
      <View style={styles.content}>
        {loading ? (
          <Animated.View key="loading" entering={motion.pop}>
            <ActivityIndicator color={textColor} />
          </Animated.View>
        ) : Icon === undefined ? null : (
          <Icon color={textColor} size={20} strokeWidth={2.25} />
        )}
        <Text variant="bodyStrong" style={{ color: textColor }} numberOfLines={2} align="center">
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget + space.xs,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fill: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  inactive: { opacity: 0.5 },
  shine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(255, 255, 255, 0.28)',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
});
