import { forwardRef, useState } from 'react';
import { StyleSheet, TextInput, type TextInputProps, View } from 'react-native';

import { radius, space, touchTarget, typography, useTheme } from '@/theme';

import { Text } from './text';

export interface TextFieldProps extends Omit<TextInputProps, 'style' | 'placeholderTextColor'> {
  label: string;
  /** Shown below the field in red and announced to screen readers. */
  error?: string | null;
  /** Neutral help or live status below the field (e.g. "available"). */
  helper?: string | null;
  helperTone?: 'muted' | 'success';
  /** Element at the start of the field (e.g. "@"). */
  prefix?: string;
}

export const TextField = forwardRef<TextInput, TextFieldProps>(function TextField(
  { label, error, helper, helperTone = 'muted', prefix, onFocus, onBlur, ...props },
  ref,
) {
  const { colors } = useTheme();
  const [focused, setFocused] = useState(false);
  const message = error ?? helper ?? null;
  const borderColor = error ? colors.danger : focused ? colors.primary : colors.border;

  return (
    <View style={styles.container}>
      <Text variant="subhead" color="textMuted" nativeID={`${label}-label`}>
        {label}
      </Text>
      <View style={[styles.field, { backgroundColor: colors.surface, borderColor }]}>
        {prefix === undefined ? null : (
          <Text variant="body" color="textMuted" importantForAccessibility="no">
            {prefix}
          </Text>
        )}
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          accessibilityLabelledBy={`${label}-label`}
          accessibilityHint={message ?? undefined}
          placeholderTextColor={colors.textMuted}
          selectionColor={colors.primary}
          maxFontSizeMultiplier={typography.body.maxScale}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          {...props}
          style={[typography.body.style, styles.input, { color: colors.text }]}
        />
      </View>
      {message === null ? null : (
        <Text
          variant="footnote"
          color={error ? 'danger' : helperTone === 'success' ? 'success' : 'textMuted'}
          accessibilityLiveRegion="polite"
        >
          {message}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: { gap: space.xs },
  field: {
    minHeight: touchTarget + space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  input: { flex: 1, paddingVertical: space.md },
});
