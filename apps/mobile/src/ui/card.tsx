import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';

import { Text } from './text';

/**
 * Things that belong together on a screen, on one card under an optional title (the owner,
 * 2026-10-23: a screen of text running straight down said nothing at a glance).
 */
export function Card({
  title,
  children,
  testID,
}: {
  title?: string;
  children: ReactNode;
  testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <View
      testID={testID}
      style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {title === undefined ? null : (
        <Text variant="headline" accessibilityRole="header">
          {title}
        </Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: space.lg,
    gap: space.md,
  },
});
