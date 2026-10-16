import type { Plan, PlusProduct } from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FlaskConical, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { ageKey, fetchAge, isMinor } from '@/features/account/age-api';
import { billingApi } from '@/features/billing/billing-api';
import { planKey, usePlan } from '@/features/billing/plan';
import { daysLeft, PLUS_PRICES, priceText, yearlySaving } from '@/features/billing/plan-model';
import { errorMessage } from '@/features/errors';
import { useNow } from '@/features/location/clock';
import { radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, SectionTitle } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** What Bargu+ gives, as the plan table says (BARGU_PLAN Faz 9B). */
const GIVES = ['circles', 'history', 'until', 'themes', 'gift'] as const;
/** Free stays free: what nobody pays for, ever (docs/ADR/0024 §9). */
const ALWAYS_FREE = ['join', 'safety'] as const;

/**
 * Bargu+ (docs/ADR/0024): what it gives, the two plans with the yearly one first, the account's
 * plan now, and cancelling in one tap. Where the server has test billing on (staging, preview
 * builds) buying is a test purchase with no payment and the screen says so on a band; elsewhere,
 * until a store is connected, buying is not offered yet. 15-17 needs a parent's yes.
 */
export default function PlusScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const celebrate = useCelebration((state) => state.celebrate);
  const now = useNow();
  const plan = usePlan();
  const age = useQuery({ queryKey: ageKey, queryFn: fetchAge });
  const teen = isMinor(age.data);
  const [choice, setChoice] = useState<PlusProduct>('plus_year');

  const settled = (next: Plan) => {
    queryClient.setQueryData(planKey, next);
  };
  const buy = useMutation({
    mutationFn: (product: PlusProduct) => billingApi.testPurchase(product),
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
  const cancel = useMutation({
    mutationFn: () => billingApi.simulate('cancel'),
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
        text: current.autoRenew
          ? t('plus.renews', { plan: kind, date: date(current.expiresAt) })
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
  const testing = current?.testBilling === true;
  const cancellable = subscribed && current.autoRenew && current.source === 'test';

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

  const footer = subscribed ? undefined : teen ? (
    <Text variant="footnote" color="textMuted" align="center">
      {t('plus.teen')}
    </Text>
  ) : testing ? (
    <Button
      testID="plus-buy"
      label={t('plus.buy', {
        price: priceText(PLUS_PRICES[choice], i18n.language),
        per: choice === 'plus_year' ? t('plus.perYear') : t('plus.perMonth'),
      })}
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

  return (
    <Screen title={t('plus.title')} subtitle={t('plus.subtitle')} footer={footer}>
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
    </Screen>
  );
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
  offer: { gap: space.xs, padding: space.lg, borderRadius: radius.lg, borderWidth: space.xxs },
  offerHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
