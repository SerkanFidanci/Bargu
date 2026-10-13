import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { type ColorTokens, elevation, radius, touchTarget, useTheme } from '@/theme';
import type { HapticKind } from '@/theme/motion';

import { PressableScale } from './pressable-scale';

export interface IconButtonProps {
  icon: LucideIcon;
  /** Required: an icon alone says nothing to a screen reader. */
  label: string;
  onPress: () => void;
  tone?: 'raised' | 'primary' | 'plain';
  size?: number;
  haptic?: HapticKind | undefined;
  selected?: boolean;
  testID?: string;
}

const TONES: Record<
  NonNullable<IconButtonProps['tone']>,
  { background: keyof ColorTokens | null; icon: keyof ColorTokens; shadow: boolean }
> = {
  raised: { background: 'surfaceRaised', icon: 'text', shadow: true },
  primary: { background: 'primary', icon: 'onPrimary', shadow: true },
  plain: { background: null, icon: 'text', shadow: false },
};

export function IconButton({
  icon: Icon,
  label,
  onPress,
  tone = 'raised',
  size = touchTarget,
  haptic = 'select',
  selected,
  testID,
}: IconButtonProps) {
  const { colors } = useTheme();
  const look = TONES[tone];
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      haptic={haptic}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={selected === undefined ? undefined : { selected }}
      hitSlop={Math.max(0, (touchTarget - size) / 2)}
      style={[
        styles.base,
        { width: size, height: size },
        look.background === null ? null : { backgroundColor: colors[look.background] },
        look.shadow ? { boxShadow: elevation.raised } : null,
      ]}
    >
      <Icon color={colors[look.icon]} size={size * 0.46} strokeWidth={2.25} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  base: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
});
