import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';
import { Text } from '@/ui/text';

export interface FormScreenProps {
  title: string;
  body?: string | undefined;
  /** Small line above the title, e.g. "Step 1 of 2". */
  eyebrow?: string | undefined;
  children: ReactNode;
  /** Primary action pinned above the keyboard. */
  footer: ReactNode;
}

/**
 * Layout of every sign-in and onboarding step: title, explanation, fields, and the main button
 * kept above the keyboard. Scrolls when large text sizes make it taller than a small phone.
 */
export function FormScreen({ title, body, eyebrow, children, footer }: FormScreenProps) {
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {eyebrow === undefined ? null : (
            <Text variant="caption" color="textMuted">
              {eyebrow}
            </Text>
          )}
          <Text variant="title1" accessibilityRole="header">
            {title}
          </Text>
          {body === undefined ? null : (
            <Text variant="callout" color="textMuted">
              {body}
            </Text>
          )}
          <View style={styles.fields}>{children}</View>
        </ScrollView>
        <View style={styles.footer}>{footer}</View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: space.xl, gap: space.md, flexGrow: 1 },
  fields: { marginTop: space.lg, gap: space.lg },
  footer: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
});
