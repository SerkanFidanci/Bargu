import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';

import { BrandFill } from './brand-fill';
import { PressableScale } from './pressable-scale';
import { Text } from './text';

/**
 * Smallest the label may shrink to before it would break: a row of four tiles on a narrow phone
 * at the largest text size still reads each name whole (QA, Faz 9).
 */
export const ACTION_LABEL_MIN_SCALE = 0.6;

export interface ActionTileProps {
  label: string;
  icon: LucideIcon;
  onPress: () => void;
  /** The one main action of a row: filled with the brand colour. */
  primary?: boolean;
  disabled?: boolean;
  testID?: string;
}

/**
 * An action in a row under a card: its icon above, its name below on one line. Unlike a pill
 * button, a row of four keeps every name whole on a narrow screen and at large text sizes.
 */
export function ActionTile({
  label,
  icon: Icon,
  onPress,
  primary = false,
  disabled = false,
  testID,
}: ActionTileProps) {
  const { colors } = useTheme();
  // The primary one wears the brand's sweep, as the main buttons do (docs/ADR/0008 Ek 2026-10-29).
  const foreground = primary ? colors.onBrand : colors.text;
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={[
        styles.tile,
        { backgroundColor: primary ? colors.primary : colors.surface },
        disabled ? styles.inactive : null,
      ]}
    >
      {primary ? <BrandFill /> : null}
      <Icon color={foreground} size={22} strokeWidth={2.25} />
      <Text
        variant="footnote"
        align="center"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={ACTION_LABEL_MIN_SCALE}
        style={[styles.label, { color: foreground }]}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    minHeight: touchTarget + space.lg,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  label: { alignSelf: 'stretch' },
  inactive: { opacity: 0.5 },
});
