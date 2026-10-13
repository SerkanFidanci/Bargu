import type { LucideIcon } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { type ColorTokens, radius, space, touchTarget, useTheme } from '@/theme';
import type { HapticKind } from '@/theme/motion';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const PALETTE: Record<
  ButtonVariant,
  { background: keyof ColorTokens | null; text: keyof ColorTokens }
> = {
  primary: { background: 'primary', text: 'onPrimary' },
  secondary: { background: 'surface', text: 'text' },
  ghost: { background: null, text: 'primary' },
  danger: { background: 'danger', text: 'onDanger' },
};

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
  const palette = PALETTE[variant];
  const inactive = disabled || loading;
  const textColor = colors[palette.text];

  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={inactive}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={[
        styles.base,
        fill ? styles.fill : styles.hug,
        palette.background === null ? null : { backgroundColor: colors[palette.background] },
        inactive ? styles.inactive : null,
      ]}
    >
      <View style={styles.content}>
        {loading ? (
          <ActivityIndicator color={textColor} />
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
  },
  fill: { alignSelf: 'stretch' },
  hug: { alignSelf: 'flex-start' },
  inactive: { opacity: 0.5 },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
  },
});
