import { forwardRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { choreography, radius, space, spring, timing, typography, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';

import { Text } from './text';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all digits are in (typed, pasted or autofilled from the email). */
  onComplete?: (code: string) => void;
  length: number;
  label: string;
  error?: boolean;
  disabled?: boolean;
  testID?: string;
}

/**
 * Login code entry: one real (invisible) text field under a row of digit boxes, so paste and the
 * OS one-time-code autofill work, and screen readers see a single labelled field. Boxes pop as
 * digits arrive; a wrong code shakes the row.
 */
export const CodeInput = forwardRef<TextInput, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, length, label, error = false, disabled = false, testID },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const reduced = useReducedMotion();
  const shake = useSharedValue(0);
  const cells = Array.from({ length }, (_, index) => value[index] ?? '');
  const active = Math.min(value.length, length - 1);

  useEffect(() => {
    if (!error) return;
    feedback('error');
    if (reduced) return;
    const { distance, step, times } = choreography.shake;
    const swing = Array.from({ length: times }, () => [
      withTiming(distance, { duration: step }),
      withTiming(-distance, { duration: step }),
    ]).flat();
    shake.set(withSequence(...swing, withSpring(0, spring.snappy)));
  }, [error, reduced, shake]);

  const row = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));

  return (
    <Pressable
      accessible={false}
      onPress={() => {
        if (ref !== null && typeof ref !== 'function') ref.current?.focus();
      }}
    >
      <Animated.View style={[styles.row, row]}>
        {cells.map((digit, index) => (
          <Cell
            key={index}
            digit={digit}
            current={focused && index === active}
            error={error}
            groupEnd={index === length / 2 - 1}
          />
        ))}
      </Animated.View>
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        editable={!disabled}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, length);
          onChange(digits);
          if (digits.length === length) onComplete?.(digits);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        accessibilityLabel={label}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        caretHidden
        maxFontSizeMultiplier={typography.code.maxScale}
        style={styles.hiddenInput}
      />
    </Pressable>
  );
});

function Cell({
  digit,
  current,
  error,
  groupEnd,
}: {
  digit: string;
  current: boolean;
  error: boolean;
  groupEnd: boolean;
}) {
  const { colors } = useTheme();
  const scale = useSharedValue(1);

  useEffect(() => {
    if (digit === '') return;
    scale.set(
      withSequence(withTiming(choreography.pop, timing.fast), withSpring(1, spring.bouncy)),
    );
  }, [digit, scale]);

  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));

  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.cell,
        {
          backgroundColor: current ? colors.primarySoft : colors.surface,
          borderColor: error ? colors.danger : current ? colors.primary : colors.border,
        },
        groupEnd ? styles.groupGap : null,
        style,
      ]}
    >
      <Text
        variant="code"
        numberOfLines={1}
        adjustsFontSizeToFit
        minimumFontScale={0.6}
        align="center"
      >
        {digit}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: space.xs, alignItems: 'center' },
  cell: {
    flex: 1,
    aspectRatio: 0.78,
    borderRadius: radius.sm,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xxs,
  },
  groupGap: { marginRight: space.sm },
  // Covers the boxes so a tap anywhere focuses it; invisible but still focusable and autofillable.
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0.011, color: 'transparent' },
});
