import { router } from 'expo-router';
import { ChevronLeft } from 'lucide-react-native';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { space, useTheme } from '@/theme';

import { Appear } from './appear';
import { IconButton } from './icon-button';
import { KEYBOARD_BEHAVIOR } from './keyboard';
import { Text } from './text';

export interface ScreenProps {
  title: string;
  /** Under the title, e.g. who or what this screen is about. */
  subtitle?: string | undefined;
  /** Right side of the top bar (an icon button). */
  action?: ReactNode;
  children: ReactNode;
  /** Pinned under the content, above the keyboard. */
  footer?: ReactNode;
  testID?: string;
}

/**
 * Layout of the screens opened from sheets (circle, add friend, safety number): a back button,
 * the title, and content that slides in piece by piece and scrolls on small phones.
 */
export function Screen({ title, subtitle, action, children, footer, testID }: ScreenProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]} testID={testID}>
      <KeyboardAvoidingView style={styles.screen} behavior={KEYBOARD_BEHAVIOR}>
        <View style={styles.bar}>
          <IconButton
            icon={ChevronLeft}
            label={t('common.back')}
            tone="plain"
            onPress={() => {
              router.back();
            }}
          />
          <View style={styles.barTitle}>
            <Text variant="headline" numberOfLines={1} accessibilityRole="header">
              {title}
            </Text>
            {subtitle === undefined ? null : (
              <Text variant="footnote" color="textMuted" numberOfLines={1}>
                {subtitle}
              </Text>
            )}
          </View>
          <View style={styles.barAction}>{action}</View>
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {children}
        </ScrollView>
        {footer === undefined ? null : (
          <Appear index={4} style={styles.footer}>
            {footer}
          </Appear>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/** A small heading over a group of rows. */
export function SectionTitle({ children }: { children: string }) {
  return (
    <Text variant="subhead" color="textMuted" accessibilityRole="header">
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  barTitle: { flex: 1, alignItems: 'center' },
  barAction: { minWidth: space.xxxl, alignItems: 'flex-end' },
  content: { paddingHorizontal: space.xl, paddingVertical: space.lg, gap: space.lg },
  footer: {
    paddingHorizontal: space.xl,
    paddingBottom: space.lg,
    paddingTop: space.sm,
    gap: space.sm,
  },
});
