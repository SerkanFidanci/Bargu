import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { elevation, radius, space, touchTarget, useTheme } from '@/theme';

import { PressableScale } from './pressable-scale';

export interface PillProps {
  children: ReactNode;
  onPress?: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
}

/** A floating rounded bar over the map (e.g. "who sees me"); pressable when given `onPress`. */
export function Pill({
  children,
  onPress,
  accessibilityLabel,
  accessibilityHint,
  testID,
}: PillProps) {
  const { colors } = useTheme();
  const look = [
    styles.pill,
    { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
  ];
  if (onPress === undefined) {
    return (
      <View testID={testID} accessible accessibilityLabel={accessibilityLabel} style={look}>
        {children}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID}
      onPress={onPress}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      style={look}
    >
      {children}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    alignSelf: 'center',
  },
});
