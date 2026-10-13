import { useTheme } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useApiStatus } from '@/features/dev/use-api-status';

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
        {__DEV__ ? <DevApiStatus /> : null}
      </View>
    </SafeAreaView>
  );
}

function DevApiStatus() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const status = useApiStatus();

  return (
    <Text accessibilityLiveRegion="polite" style={[styles.devStatus, { color: colors.text }]}>
      {t(`dev.api.${status}`)}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  title: { fontSize: 34, fontWeight: '700' },
  tagline: { fontSize: 17, textAlign: 'center' },
  devStatus: { fontSize: 13, opacity: 0.6 },
});
