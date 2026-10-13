import { useEffect } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  interpolateColor,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { space, spring, touchTarget, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';

import { Text } from './text';

export interface ToggleProps {
  value: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
  testID?: string;
}

const TRACK_WIDTH = 52;
const TRACK_HEIGHT = 32;
const THUMB = 26;
const TRAVEL = TRACK_WIDTH - THUMB - (TRACK_HEIGHT - THUMB);

/** On/off switch with its label; the whole row is the touch target and reads as a switch. */
export function Toggle({
  value,
  onChange,
  label,
  description,
  disabled = false,
  testID,
}: ToggleProps) {
  const { colors } = useTheme();
  const progress = useSharedValue(value ? 1 : 0);

  useEffect(() => {
    progress.set(withSpring(value ? 1 : 0, spring.snappy));
  }, [progress, value]);

  const track = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.get(), [0, 1], [colors.border, colors.primary]),
  }));
  const thumb = useAnimatedStyle(() => ({
    transform: [{ translateX: progress.get() * TRAVEL }],
  }));

  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => {
        feedback('select');
        onChange(!value);
      }}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      style={[styles.row, disabled ? styles.disabled : null]}
    >
      <View style={styles.text}>
        <Text variant="body">{label}</Text>
        {description === undefined ? null : (
          <Text variant="footnote" color="textMuted">
            {description}
          </Text>
        )}
      </View>
      <Animated.View style={[styles.track, track]}>
        <Animated.View style={[styles.thumb, { backgroundColor: colors.surfaceRaised }, thumb]} />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingVertical: space.sm,
  },
  disabled: { opacity: 0.5 },
  text: { flex: 1, gap: space.xxs },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: (TRACK_HEIGHT - THUMB) / 2,
  },
  thumb: { width: THUMB, height: THUMB, borderRadius: THUMB / 2 },
});
