import type { TestSimulate } from '@bargu/schemas';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { planKey, usePlan } from '@/features/billing/plan';
import { testBillingOf, useTestBilling } from '@/features/billing/test-slot';
import { errorMessage } from '@/features/errors';
import { space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** What a store would do, in the order a subscription lives it (docs/ADR/0024 §6). */
const ACTIONS: readonly TestSimulate['action'][] = [
  'renew',
  'cancel',
  'fail',
  'recover',
  'expire',
  'refund',
  'endTrial',
];

/**
 * Test billing (developer menu, preview builds only): buy with no payment and play what a store
 * would do, to see a circle pause and open, the grace days and the trial's end. Works only where
 * the server has test billing on.
 */
export function BillingDevScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const plan = usePlan();
  // A build can have the developer tools without test billing (EXPO_PUBLIC_TEST_BILLING).
  const tester = useTestBilling((state) => state.api);
  const run = useMutation({
    mutationFn: (step: { kind: 'buy'; product: 'plus_month' | 'plus_year' } | TestSimulate) => {
      const billing = testBillingOf(tester);
      return 'product' in step ? billing.purchase(step.product) : billing.simulate(step.action);
    },
    onSuccess: (next) => {
      queryClient.setQueryData(planKey, next);
      toast.success(t('dev.billing.done', { plan: t(`dev.billing.plan_${next.plan}`) }));
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });

  const current = plan.data;

  return (
    <>
      <Stack.Screen options={{ title: t('dev.billing.title') }} />
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.content}
      >
        <Text variant="callout" color="textMuted">
          {current === undefined
            ? '…'
            : t('dev.billing.now', {
                plan: t(`dev.billing.plan_${current.plan}`),
                source: current.source ?? '-',
                test: current.testBilling ? t('dev.ui.on') : t('dev.ui.off'),
              })}
        </Text>
        <View style={styles.row}>
          <Button
            label={t('dev.billing.buyMonth')}
            loading={run.isPending}
            onPress={() => {
              run.mutate({ kind: 'buy', product: 'plus_month' });
            }}
          />
          <Button
            label={t('dev.billing.buyYear')}
            variant="secondary"
            loading={run.isPending}
            onPress={() => {
              run.mutate({ kind: 'buy', product: 'plus_year' });
            }}
          />
        </View>
        {ACTIONS.map((action) => (
          <Button
            key={action}
            testID={`dev-billing-${action}`}
            label={t(`dev.billing.${action}`)}
            variant="secondary"
            loading={run.isPending}
            onPress={() => {
              run.mutate({ action });
            }}
          />
        ))}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.xl, gap: space.md },
  row: { flexDirection: 'row', gap: space.md, flexWrap: 'wrap' },
});
