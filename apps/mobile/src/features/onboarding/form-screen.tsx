import type { ReactNode } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';
import { Appear } from '@/ui/appear';
import { Text } from '@/ui/text';
import { KEYBOARD_BEHAVIOR } from '@/ui/keyboard';

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
      <KeyboardAvoidingView style={styles.screen} behavior={KEYBOARD_BEHAVIOR}>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {/* Title, text, fields and actions slide in one after another. */}
          {eyebrow === undefined ? null : (
            <Appear index={0}>
              <Text variant="caption" color="textMuted">
                {eyebrow}
              </Text>
            </Appear>
          )}
          <Appear index={1}>
            <Text variant="title1" accessibilityRole="header">
              {title}
            </Text>
          </Appear>
          {body === undefined ? null : (
            <Appear index={2}>
              <Text variant="callout" color="textMuted">
                {body}
              </Text>
            </Appear>
          )}
          <Appear index={3} style={styles.fields}>
            {children}
          </Appear>
        </ScrollView>
        <Appear index={4} style={styles.footer}>
          {footer}
        </Appear>
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
