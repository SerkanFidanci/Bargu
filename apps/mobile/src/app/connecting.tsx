import { useTranslation } from 'react-i18next';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';
import { Text } from '@/ui/text';

/** Shown while the profile cannot load yet (e.g. offline at start); it retries on its own. */
export default function ConnectingScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.primary} />
      <Text variant="callout" color="textMuted" accessibilityLiveRegion="polite">
        {t('main.connecting')}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.md },
});
