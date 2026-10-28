import { Children, Fragment, isValidElement, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { avatarSize, radius, space, useTheme } from '@/theme';

/**
 * Rows that belong together on one card, a hairline between each (the owner, 2026-10-28: the
 * Messages list ran together, nothing told one conversation from the next). The line starts where
 * the row's text does, under a leading avatar.
 */
export function ListGroup({ children, testID }: { children: ReactNode; testID?: string }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View
      testID={testID}
      style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {rows.map((row, index) => (
        <Fragment key={isValidElement(row) && row.key !== null ? row.key : index}>
          {index === 0 ? null : (
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          )}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  divider: { height: StyleSheet.hairlineWidth * 2, marginLeft: avatarSize.md + space.md },
});
