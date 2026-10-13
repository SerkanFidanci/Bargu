import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

export interface SegmentedProps<T extends string> {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}

/** A small set of mutually exclusive choices side by side, read as a radio group. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testID,
}: SegmentedProps<T>) {
  const { colors } = useTheme();
  return (
    <View style={styles.container}>
      <Text variant="subhead" color="textMuted">
        {label}
      </Text>
      <View
        testID={testID}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={[styles.track, { backgroundColor: colors.surface }]}
      >
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <PressableScale
              key={option.value}
              haptic="select"
              accessibilityRole="radio"
              accessibilityLabel={option.label}
              accessibilityState={{ selected }}
              onPress={() => {
                if (!selected) onChange(option.value);
              }}
              style={[styles.segment, selected ? { backgroundColor: colors.primary } : null]}
            >
              <Text
                variant="subhead"
                align="center"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ color: selected ? colors.onPrimary : colors.text }}
              >
                {option.label}
              </Text>
            </PressableScale>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  track: { flexDirection: 'row', borderRadius: radius.pill, padding: space.xxs, gap: space.xxs },
  segment: {
    flex: 1,
    minHeight: touchTarget - space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.sm,
  },
});
