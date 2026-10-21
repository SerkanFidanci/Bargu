import { ChevronRight, type LucideIcon } from 'lucide-react-native';
import { Children, Fragment, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

/** Rows that belong together on one card, a hairline between them (the theme of 2026-10-18). */
export function SettingsGroup({ children }: { children: ReactNode }) {
  const { colors } = useTheme();
  const rows = Children.toArray(children);
  return (
    <View style={[styles.group, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {rows.map((row, index) => (
        <Fragment key={index}>
          {index === 0 ? null : (
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          )}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One setting: an icon, its name and what it is set to now. With `onPress` it leads somewhere
 * (its own screen, the owner: "tıklanınca kendi ekranları açılacak"), shown by a chevron.
 */
export function SettingsRow({
  icon: Icon,
  label,
  detail,
  onPress,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  detail?: string | undefined;
  onPress?: (() => void) | undefined;
  testID?: string | undefined;
}) {
  const { colors } = useTheme();
  const content = (
    <>
      <View style={[styles.rowIcon, { backgroundColor: colors.primarySoft }]}>
        <Icon color={colors.primary} size={20} strokeWidth={2.25} />
      </View>
      <View style={styles.rowText}>
        <Text variant="body">{label}</Text>
        {detail === undefined ? null : (
          <Text variant="footnote" color="textMuted">
            {detail}
          </Text>
        )}
      </View>
      {onPress === undefined ? null : (
        <ChevronRight color={colors.textMuted} size={20} strokeWidth={2.25} />
      )}
    </>
  );
  if (onPress === undefined) {
    return (
      <View
        style={styles.row}
        accessible
        accessibilityLabel={detail ? `${label}, ${detail}` : label}
      >
        {content}
      </View>
    );
  }
  return (
    <PressableScale
      testID={testID}
      haptic="select"
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      style={styles.row}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  group: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space.md,
  },
  divider: { height: StyleSheet.hairlineWidth * 2, marginLeft: touchTarget + space.xs },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: touchTarget + space.md,
  },
  rowIcon: {
    width: touchTarget - space.sm,
    height: touchTarget - space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: { flex: 1, gap: space.xxs },
});
