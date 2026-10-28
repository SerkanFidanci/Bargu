import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { useGlow } from '@/theme/effects';

import { PressableScale } from './pressable-scale';
import { Text } from './text';

export interface SegmentedProps<T extends string> {
  label: string;
  /** An icon beside each label (the theme of 2026-10-18); its meaning is always in the label. */
  options: readonly { value: T; label: string; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  testID?: string;
}

/**
 * A small set of mutually exclusive choices side by side, read as a radio group: the chosen one
 * filled navy, with a still glow (none at sade mod "off").
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  testID,
}: SegmentedProps<T>) {
  const { colors } = useTheme();
  const glow = useGlow();
  return (
    <View style={styles.container}>
      <Text variant="subhead" color="textMuted">
        {label}
      </Text>
      <View
        testID={testID}
        accessibilityRole="radiogroup"
        accessibilityLabel={label}
        style={[styles.track, { backgroundColor: colors.surface, borderColor: colors.border }]}
      >
        {options.map((option) => {
          const selected = option.value === value;
          const ink = selected ? colors.onPrimary : colors.text;
          const Icon = option.icon;
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
              style={[
                styles.segment,
                selected
                  ? {
                      backgroundColor: colors.primary,
                      ...(glow === undefined ? {} : { boxShadow: glow }),
                    }
                  : null,
              ]}
            >
              {Icon === undefined ? null : <Icon color={ink} size={18} strokeWidth={2.25} />}
              <Text
                variant="subhead"
                align="center"
                numberOfLines={1}
                adjustsFontSizeToFit
                style={[styles.label, { color: ink }]}
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
  track: {
    flexDirection: 'row',
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    padding: space.xxs,
    gap: space.xxs,
  },
  segment: {
    flex: 1,
    flexDirection: 'row',
    minHeight: touchTarget - space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
  },
  label: { flexShrink: 1 },
});
