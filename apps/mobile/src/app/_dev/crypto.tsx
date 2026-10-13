import { Redirect, useTheme } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DEV_TOOLS_ENABLED } from '@/config/env';
import {
  ENCRYPT_BUDGET_MS,
  runCryptoBenchmark,
  type BenchmarkResult,
} from '@/features/dev/crypto-benchmark';

type RunState =
  | { phase: 'idle' }
  | { phase: 'running' }
  | { phase: 'done'; results: BenchmarkResult[] }
  | { phase: 'failed' };

// Dev-only: measures on-device crypto speed (Faz 1 DoD). Not reachable in production builds.
export default function CryptoBenchmarkScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [run, setRun] = useState<RunState>({ phase: 'idle' });

  if (!DEV_TOOLS_ENABLED) return <Redirect href="/" />;

  const start = () => {
    setRun({ phase: 'running' });
    // Let the "running" frame render before the synchronous benchmark blocks the JS thread.
    setTimeout(() => {
      try {
        setRun({ phase: 'done', results: runCryptoBenchmark() });
      } catch {
        setRun({ phase: 'failed' });
      }
    }, 50);
  };

  const encrypt = run.phase === 'done' ? run.results.find((r) => r.id === 'encrypt') : undefined;
  const passed = encrypt !== undefined && encrypt.p95Ms < ENCRYPT_BUDGET_MS;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>
          {t('dev.crypto.title')}
        </Text>
        <Text style={[styles.note, { color: colors.text }]}>
          {t('dev.crypto.budget', { ms: ENCRYPT_BUDGET_MS })}
        </Text>

        <Pressable
          accessibilityRole="button"
          disabled={run.phase === 'running'}
          onPress={start}
          style={[styles.button, { backgroundColor: colors.primary }]}
        >
          <Text style={styles.buttonText}>
            {run.phase === 'running' ? t('dev.crypto.running') : t('dev.crypto.start')}
          </Text>
        </Pressable>

        {run.phase === 'failed' ? (
          <Text style={[styles.note, { color: colors.notification }]}>
            {t('dev.crypto.failed')}
          </Text>
        ) : null}

        {run.phase === 'done' ? (
          <View style={styles.results}>
            <Text accessibilityLiveRegion="polite" style={[styles.verdict, { color: colors.text }]}>
              {passed ? t('dev.crypto.passed') : t('dev.crypto.notPassed')}
            </Text>
            {run.results.map((result) => (
              <Text key={result.id} style={[styles.row, { color: colors.text }]}>
                {t(`dev.crypto.ops.${result.id}`)}:{' '}
                {t('dev.crypto.timing', {
                  median: result.medianMs.toFixed(2),
                  p95: result.p95Ms.toFixed(2),
                  n: result.iterations,
                })}
              </Text>
            ))}
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700' },
  note: { fontSize: 15 },
  button: { borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#ffffff', fontSize: 17, fontWeight: '600' },
  results: { gap: 8 },
  verdict: { fontSize: 18, fontWeight: '700' },
  row: { fontSize: 14, fontVariant: ['tabular-nums'] },
});
