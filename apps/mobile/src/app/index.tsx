import { Link, useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEV_TOOLS_ENABLED } from '@/config/env';
import { useApiStatus } from '@/features/status/use-api-status';

// Placeholder home screen for Faz 0. The map-first UI and design tokens arrive in Faz 3.
export default function HomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          Bargu
        </Text>
        <Text style={[styles.tagline, { color: colors.text }]}>{t('home.tagline')}</Text>
        <ApiStatus />
        {DEV_TOOLS_ENABLED ? (
          <Link href="/_dev/crypto" style={[styles.devLink, { color: colors.primary }]}>
            {t('home.devTools')}
          </Link>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

function ApiStatus() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useApiStatus();

  return (
    <Text accessibilityLiveRegion="polite" style={[styles.apiStatus, { color: colors.text }]}>
      {t(`status.api.${status}`)}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 34, fontWeight: '700' },
  tagline: { fontSize: 17, textAlign: 'center' },
  apiStatus: { fontSize: 13, opacity: 0.6 },
  devLink: { fontSize: 13, marginTop: 24 },
});
