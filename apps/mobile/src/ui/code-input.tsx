import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { radius, space, typography, useTheme } from '@/theme';

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
 * OS one-time-code autofill work, and screen readers see a single labelled field.
 */
export const CodeInput = forwardRef<TextInput, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, length, label, error = false, disabled = false, testID },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const cells = Array.from({ length }, (_, index) => value[index] ?? '');
  const active = Math.min(value.length, length - 1);

  return (
    <Pressable
      accessible={false}
      onPress={() => {
        if (ref !== null && typeof ref !== 'function') ref.current?.focus();
      }}
      style={styles.row}
    >
      {cells.map((digit, index) => {
        const current = focused && index === active;
        return (
          <View
            key={index}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
            style={[
              styles.cell,
              {
                backgroundColor: colors.surface,
                borderColor: error ? colors.danger : current ? colors.primary : colors.border,
              },
              index === length / 2 - 1 ? styles.groupGap : null,
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
          </View>
        );
      })}
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
