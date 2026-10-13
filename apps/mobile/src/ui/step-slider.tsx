import { useEffect, useState } from 'react';
import { type LayoutChangeEvent, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { space, spring, touchTarget, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';

import { Text } from './text';

export interface StepSliderProps<T extends string> {
  /** Ordered stops, e.g. precision: exact → neighbourhood → city. */
  steps: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  testID?: string;
}

const THUMB = 28;
const TRACK = 6;

/**
 * A slider that snaps to a few named stops, with a haptic tick on each. Dragging runs on the UI
 * thread; screen readers get an adjustable control with increment/decrement actions.
 */
export function StepSlider<T extends string>({
  steps,
  value,
  onChange,
  label,
  testID,
}: StepSliderProps<T>) {
  const { colors } = useTheme();
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    steps.findIndex((step) => step.value === value),
  );
  const last = steps.length - 1;
  const usable = Math.max(0, width - THUMB);
  const position = useSharedValue(0);
  const start = useSharedValue(0);

  useEffect(() => {
    position.set(withSpring(last === 0 ? 0 : (index / last) * usable, spring.snappy));
  }, [index, last, position, usable]);

  const select = (next: number) => {
    const step = steps[next];
    if (step === undefined || next === index) return;
    feedback('select');
    onChange(step.value);
  };

  const snap = (x: number) => {
    'worklet';
    const nearest = usable === 0 ? 0 : Math.round((x / usable) * last);
    return Math.min(last, Math.max(0, nearest));
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      start.set(position.get());
    })
    .onUpdate((event) => {
      position.set(Math.min(usable, Math.max(0, start.get() + event.translationX)));
    })
    .onEnd(() => {
      const next = snap(position.get());
      position.set(withSpring(last === 0 ? 0 : (next / last) * usable, spring.snappy));
      scheduleOnRN(select, next);
    });
  const tap = Gesture.Tap().onEnd((event) => {
    scheduleOnRN(select, snap(event.x - THUMB / 2));
  });

  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: position.get() }] }));
  const fill = useAnimatedStyle(() => ({ width: position.get() + THUMB / 2 }));

  const current = steps[index];
  return (
    <View
      testID={testID}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      accessibilityValue={{ text: current?.label ?? '' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === 'increment') select(Math.min(last, index + 1));
        if (event.nativeEvent.actionName === 'decrement') select(Math.max(0, index - 1));
      }}
      style={styles.container}
    >
      <GestureDetector gesture={Gesture.Exclusive(pan, tap)}>
        <View
          style={styles.hitArea}
          onLayout={(event: LayoutChangeEvent) => {
            setWidth(event.nativeEvent.layout.width);
          }}
        >
          <View style={[styles.track, { backgroundColor: colors.border }]}>
            <Animated.View style={[styles.fill, { backgroundColor: colors.primary }, fill]} />
          </View>
          {steps.map((step, stop) => (
            <View
              key={step.value}
              style={[
                styles.stop,
                {
                  left: last === 0 ? 0 : (stop / last) * usable + THUMB / 2 - TRACK / 2,
                  backgroundColor: stop <= index ? colors.primary : colors.textMuted,
                },
              ]}
            />
          ))}
          <Animated.View
            style={[
              styles.thumb,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.primary },
              thumb,
            ]}
          />
        </View>
      </GestureDetector>
      <View style={styles.labels} importantForAccessibility="no-hide-descendants">
        {steps.map((step, stop) => (
          <Text
            key={step.value}
            variant="footnote"
            color={stop === index ? 'text' : 'textMuted'}
            style={styles.label}
            align={stop === 0 ? 'left' : stop === last ? 'right' : 'center'}
          >
            {step.label}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: space.xs },
  hitArea: { height: touchTarget, justifyContent: 'center' },
  track: {
    height: TRACK,
    borderRadius: TRACK / 2,
    marginHorizontal: THUMB / 2,
    overflow: 'hidden',
  },
  fill: { position: 'absolute', left: 0, top: 0, bottom: 0, marginLeft: -THUMB / 2 },
  stop: { position: 'absolute', width: TRACK, height: TRACK, borderRadius: TRACK / 2 },
  thumb: {
    position: 'absolute',
    left: 0,
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    borderWidth: 3,
  },
  labels: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  label: { flex: 1 },
});
