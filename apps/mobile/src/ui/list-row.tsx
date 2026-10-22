import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { space, touchTarget } from '@/theme';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

export interface ListRowProps {
  /** Avatar or icon on the left. */
  leading: ReactNode;
  title: string;
  /** How many lines the title may take (a long one next to buttons); one by default. */
  titleLines?: number;
  subtitle?: string | undefined;
  /** Badge, buttons or a chevron on the right. */
  trailing?: ReactNode;
  onPress?: (() => void) | undefined;
  /**
   * The trailing part has its own buttons: the row is then not grouped for screen readers (a
   * grouped row would hide them).
   */
  actions?: boolean;
  /** Read by screen readers instead of title and subtitle (e.g. with a status). */
  accessibilityLabel?: string;
  testID?: string;
}

/** A person or a circle in a list: leading visual, two lines of text, something on the right. */
export function ListRow({
  leading,
  title,
  titleLines = 1,
  subtitle,
  trailing,
  onPress,
  accessibilityLabel,
  actions = false,
  testID,
}: ListRowProps) {
  const label = accessibilityLabel ?? (subtitle === undefined ? title : `${title}, ${subtitle}`);
  const content = (
    <>
      {leading}
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={titleLines}>
          {title}
        </Text>
        {subtitle === undefined ? null : (
          <Text variant="footnote" color="textMuted" numberOfLines={2}>
            {subtitle}
          </Text>
        )}
      </View>
      {trailing}
    </>
  );
  if (onPress === undefined) {
    return (
      <View
        style={styles.row}
        testID={testID}
        accessible={!actions}
        accessibilityLabel={actions ? undefined : label}
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
      accessibilityLabel={label}
      style={styles.row}
    >
      {content}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget },
  text: { flex: 1, gap: space.xxs },
});
