import type { Plan, PlusProduct } from '@bargu/schemas';
import Constants from 'expo-constants';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ExternalLink, FlaskConical, Sparkles } from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { ageKey, fetchAge, isMinor } from '@/features/account/age-api';
import { testBillingOf, useTestBilling } from '@/features/billing/test-slot';
import { planKey, usePlan } from '@/features/billing/plan';
import {
  daysLeft,
  manageUrl,
  PLUS_PRICES,
  priceText,
  yearlySaving,
} from '@/features/billing/plan-model';
import { errorMessage, isApiError } from '@/features/errors';
import { useNow } from '@/features/location/clock';
import { radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { PressableScale } from '@/ui/pressable-scale';
import { SectionTitle } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** What Bargu+ gives, as the plan table says (BARGU_PLAN Faz 9B). */
const GIVES = ['circles', 'history', 'until', 'themes', 'gift'] as const;
/** Free stays free: what nobody pays for, ever (docs/ADR/0024 §9). */
const ALWAYS_FREE = ['join', 'safety'] as const;

/**
 * The Bargu+ shelf of the store (docs/ADR/0024; the store: ADR 0025 Ek 2): what it gives, the two
 * plans with the yearly one first, the account's plan now, and cancelling in one tap. In a build
 * with test billing (development, preview) where the server has it on (staging), buying is a test
 * purchase with no payment and the shelf says so on a band; in a production build, and until a
 * store is connected, buying is not offered: "coming soon through Google Play". A production
 * bundle has no code that could make a test purchase. 15-17 needs a parent's yes.
 *
 * The store shows `content` and puts `footer` (buy, ask a parent, "soon") under it.
 */
export function usePlusShelf(): { content: ReactNode; footer: ReactNode } {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const celebrate = useCelebration((state) => state.celebrate);
  const now = useNow();
  const plan = usePlan();
  const age = useQuery({ queryKey: ageKey, queryFn: fetchAge });
  const teen = isMinor(age.data);
  const [choice, setChoice] = useState<PlusProduct>('plus_year');
  // Only development and preview builds have test billing (features/billing/test-billing.ts).
  const tester = useTestBilling((state) => state.api);

  const settled = (next: Plan) => {
    queryClient.setQueryData(planKey, next);
  };
  const buy = useMutation({
    mutationFn: (product: PlusProduct) => testBillingOf(tester).purchase(product),
    onSuccess: (next) => {
      settled(next);
      feedback('success');
      celebrate();
      toast.success(t('plus.bought'));
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });
  // 15-17 (docs/ADR/0024 §5): the purchase is asked of a parent; the server says it waits (403
  // GUARDIAN_APPROVAL) and the plan's `pendingPurchase` follows through plan.changed.
  const ask = useMutation({
    mutationFn: (product: PlusProduct) => testBillingOf(tester).purchase(product),
    onSuccess: settled,
    onError: (error) => {
      if (isApiError(error, 'GUARDIAN_APPROVAL')) {
        feedback('success');
        toast.success(t('plus.asked'));
        return;
      }
      toast.error(errorMessage(error, t));
    },
  });
  const cancel = useMutation({
    mutationFn: () => testBillingOf(tester).simulate('cancel'),
    onSuccess: (next) => {
      settled(next);
      toast.info(t('plus.cancelled'));
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });

  const current = plan.data;
  const date = (at: number) => new Date(at).toLocaleDateString(i18n.language);
  const status = (() => {
    if (current === undefined) return null;
    if (current.graceUntil !== null) {
      return { tone: 'danger' as const, text: t('plus.grace', { date: date(current.graceUntil) }) };
    }
    if (current.plan === 'plus' && current.expiresAt !== null) {
      const kind = current.product === 'plus_year' ? t('plus.yearly') : t('plus.monthly');
      return {
        tone: 'success' as const,
        // What it costs and when, said plainly (N3).
        text: current.autoRenew
          ? t('plus.renews', {
              plan: kind,
              date: date(current.expiresAt),
              price: priceText(
                PLUS_PRICES[current.product === 'plus_year' ? 'plus_year' : 'plus_month'],
                i18n.language,
              ),
            })
          : t('plus.endsOn', { plan: kind, date: date(current.expiresAt) }),
      };
    }
    if (current.plan === 'trial' && current.trialEndsAt !== null) {
      return {
        tone: 'muted' as const,
        text: t('plus.trial', { days: daysLeft(current.trialEndsAt, now) }),
      };
    }
    return { tone: 'muted' as const, text: t('plus.free') };
  })();
  const subscribed = current?.plan === 'plus';
  const pending = current?.pendingPurchase ?? null;
  const planName = (product: PlusProduct) =>
    product === 'plus_year' ? t('plus.yearly') : t('plus.monthly');
  const priceOf = (product: PlusProduct) => ({
    price: priceText(PLUS_PRICES[product], i18n.language),
    per: product === 'plus_year' ? t('plus.perYear') : t('plus.perMonth'),
  });
  // The build has test billing and the server has it on; a production build never does.
  const testing = tester !== null && current?.testBilling === true;
  const cancellable =
    tester !== null && subscribed && current.autoRenew && current.source === 'test';
  // The store's own page for it, one tap away (N3).
  const manage =
    current === undefined
      ? null
      : manageUrl(current, Constants.expoConfig?.android?.package ?? 'app.bargu');

  const offer = (product: PlusProduct) => {
    const chosen = product === choice;
    return (
      <PressableScale
        key={product}
        testID={`plus-${product}`}
        haptic="select"
        accessibilityRole="radio"
        accessibilityState={{ selected: chosen }}
        onPress={() => {
          setChoice(product);
        }}
        style={[
          styles.offer,
          {
            backgroundColor: colors.surface,
            borderColor: chosen ? colors.primary : colors.surface,
          },
        ]}
      >
        <View style={styles.offerHead}>
          <Text variant="headline">
            {product === 'plus_year' ? t('plus.yearly') : t('plus.monthly')}
          </Text>
          {product === 'plus_year' ? (
            <Badge label={t('plus.saving', { percent: yearlySaving() })} tone="success" />
          ) : null}
        </View>
        <Text variant="title2">
          {priceText(PLUS_PRICES[product], i18n.language)}
          <Text variant="callout" color="textMuted">
            {product === 'plus_year' ? t('plus.perYear') : t('plus.perMonth')}
          </Text>
        </Text>
      </PressableScale>
    );
  };

  const teenFooter = !testing ? (
    <Text variant="footnote" color="textMuted" align="center">
      {t('plus.teenSoon')}
    </Text>
  ) : (
    <View style={styles.footer}>
      {pending === null ? null : (
        <Text variant="footnote" color="textMuted" align="center" testID="plus-pending">
          {t('plus.pending', { plan: planName(pending) })}
        </Text>
      )}
      {pending === choice ? null : (
        <Button
          testID="plus-ask"
          label={
            pending === null
              ? t('plus.ask', priceOf(choice))
              : t('plus.askOther', { plan: planName(choice) })
          }
          icon={Sparkles}
          variant={pending === null ? 'primary' : 'secondary'}
          loading={ask.isPending}
          onPress={() => {
            ask.mutate(choice);
          }}
        />
      )}
    </View>
  );
  const footer = subscribed ? undefined : teen ? (
    teenFooter
  ) : testing ? (
    <Button
      testID="plus-buy"
      label={t('plus.buy', priceOf(choice))}
      icon={Sparkles}
      loading={buy.isPending}
      onPress={() => {
        buy.mutate(choice);
      }}
    />
  ) : (
    <Text variant="footnote" color="textMuted" align="center">
      {t('plus.soon')}
    </Text>
  );

  const content = (
    <>
      {testing ? (
        <View
          testID="plus-test-band"
          style={[styles.band, { backgroundColor: colors.accent }]}
          accessible
          accessibilityLabel={t('plus.testBand')}
        >
          <FlaskConical color={colors.onAccent} size={18} strokeWidth={2.25} />
          <Text variant="subhead" style={{ color: colors.onAccent }}>
            {t('plus.testBand')}
          </Text>
        </View>
      ) : null}

      {status === null ? (
        <Skeleton width="100%" height={space.xxxl} />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }]} testID="plus-status">
          <Text variant="subhead" color="textMuted">
            {t('plus.now')}
          </Text>
          <Text
            variant="bodyStrong"
            style={{
              color:
                status.tone === 'danger'
                  ? colors.danger
                  : status.tone === 'success'
                    ? colors.success
                    : colors.text,
            }}
          >
            {status.text}
          </Text>
        </View>
      )}

      <SectionTitle>{t('plus.givesTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {GIVES.map((item) => (
          <View key={item} style={styles.point}>
            <Check color={colors.primary} size={18} strokeWidth={2.5} />
            <Text variant="callout" style={styles.pointText}>
              {t(`plus.gives.${item}`)}
            </Text>
          </View>
        ))}
      </View>

      {subscribed ? null : (
        <>
          <SectionTitle>{t('plus.choose')}</SectionTitle>
          <View style={styles.offers} accessibilityRole="radiogroup">
            {(['plus_year', 'plus_month'] as const).map(offer)}
          </View>
        </>
      )}

      <SectionTitle>{t('plus.freeTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {ALWAYS_FREE.map((item) => (
          <Text key={item} variant="callout" color="textMuted">
            {t(`plus.always.${item}`)}
          </Text>
        ))}
      </View>

      {manage === null ? null : (
        <Button
          testID="plus-manage"
          label={t('plus.manage')}
          icon={ExternalLink}
          variant="secondary"
          onPress={() => void Linking.openURL(manage)}
        />
      )}
      {cancellable ? (
        <Button
          testID="plus-cancel"
          label={t('plus.cancel')}
          variant="secondary"
          loading={cancel.isPending}
          onPress={() => {
            cancel.mutate();
          }}
        />
      ) : null}
    </>
  );
  return { content, footer };
}

const styles = StyleSheet.create({
  band: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
    alignSelf: 'center',
  },
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  point: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  pointText: { flex: 1 },
  offers: { gap: space.sm },
  footer: { gap: space.sm },
  offer: { gap: space.xs, padding: space.lg, borderRadius: radius.lg, borderWidth: space.xxs },
  offerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
