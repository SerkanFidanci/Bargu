import {
  COSMETIC_PACKS,
  type CosmeticPack,
  type FrameStyle,
  type Plan,
  type RingPattern,
} from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Sparkles } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { AvatarMarker } from '@/ui/avatar-marker';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { Hint } from '@/ui/hint';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { ageKey, fetchAge, isMinor } from '../account/age-api';
import { testBillingOf, useTestBilling } from '../billing/test-slot';
import { planKey, usePlan } from '../billing/plan';
import { priceText } from '../billing/plan-model';
import { errorMessage, isApiError } from '../errors';
import { useMe } from '../profile/queries';
import { chooseLook, refreshPass, useMyLook } from './look-session';
import {
  isFrameStyle,
  isMoving,
  isRingPattern,
  type Look,
  type LookChoice,
  PACK_PART as PART,
  PACK_PRICE,
  PACKS,
} from './look-styles';
import { stopTrying, tryStyle, useTrying } from './look-trying';

/** What a choice would look like, as far as this app knows its styles (a preview, so not checked). */
function previewOf(choice: LookChoice): Look | undefined {
  const ring = isRingPattern(choice.ring) ? choice.ring : undefined;
  const frame = isFrameStyle(choice.frame) ? choice.frame : undefined;
  return ring === undefined && frame === undefined ? undefined : { ring, frame, until: Infinity };
}

/**
 * "Pin süsleri", a shelf of the store (docs/ADR/0025, its addendum of 2026-10-21 and Ek 2): the user's
 * own pin as friends will see it, the two packs, and a style to choose from each. A style of a pack
 * not bought can be tried on the pin; buying (a test purchase where the server allows it, a
 * parent's yes for 15-17) opens it. What is chosen from a pack the account has goes to circles.
 */
export function PinLooks() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const celebrate = useCelebration((state) => state.celebrate);
  const me = useMe().data;
  const plan = usePlan();
  const age = useQuery({ queryKey: ageKey, queryFn: fetchAge });
  const teen = isMinor(age.data);
  const choice = useMyLook((state) => state.choice);
  // Styles tried from packs not bought: shown on the pin, never saved or sent. Kept apart from this
  // screen: a style tried from a pack a parent has yet to say yes to is chosen when the yes comes
  // (look-approval.ts), wherever the user is then.
  const trying = useTrying();
  const owned = (pack: CosmeticPack) => plan.data?.cosmetics.includes(pack) === true;
  // A style tried from a pack that has since become theirs (a parent said yes) is no longer a
  // trial: look-approval.ts chooses it, so the pin shows what is chosen, never a trial of a pack
  // the user has.
  const shownPart = (pack: CosmeticPack) => {
    const part = PART[pack];
    const tried = owned(pack) ? undefined : trying[part];
    return tried === undefined ? choice[part] : tried;
  };
  const shown: LookChoice = { ring: shownPart('rings'), frame: shownPart('frames') };
  const look = previewOf(shown);
  // Only development and preview builds have test billing (features/billing/test-billing.ts).
  const tester = useTestBilling((state) => state.api);
  const testing = tester !== null && plan.data?.testBilling === true;

  const pick = (pack: CosmeticPack, id: string | null) => {
    const part = PART[pack];
    if (!owned(pack)) {
      tryStyle(part, id);
      return;
    }
    stopTrying(part);
    chooseLook({ ...choice, [part]: id }).catch(() => undefined);
  };

  const buy = useMutation({
    mutationFn: (pack: CosmeticPack) => testBillingOf(tester).purchase(`cosmetic:${pack}`),
    onSuccess: (next, pack) => {
      queryClient.setQueryData(planKey, next);
      // The new pack is in the next pass; the style tried goes to circles with it.
      const part = PART[pack];
      const tried = trying[part];
      stopTrying(part);
      refreshPass(true)
        .then(async () => {
          if (tried !== undefined) {
            await chooseLook({ ...useMyLook.getState().choice, [part]: tried });
          }
        })
        .catch(() => undefined);
      feedback('success');
      celebrate();
      toast.success(t('cosmetics.bought'));
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });
  // 15-17 (docs/ADR/0025 §6): the pack is asked of a parent. The server keeps the request and
  // answers 403 GUARDIAN_APPROVAL; the plan's `pendingCosmetics` says what waits, on every phone of
  // theirs, and follows a parent's answer through plan.changed (no polling).
  const ask = useMutation({
    mutationFn: (pack: CosmeticPack) => testBillingOf(tester).purchase(`cosmetic:${pack}`),
    // A pack they already have needs no one's yes: the server just answers the plan.
    onSuccess: (next) => {
      queryClient.setQueryData(planKey, next);
    },
    onError: (error, pack) => {
      if (isApiError(error, 'GUARDIAN_APPROVAL')) {
        // Waiting at once on this phone; the server tells the others.
        queryClient.setQueryData<Plan>(planKey, (current) =>
          current === undefined
            ? current
            : {
                ...current,
                pendingCosmetics: [...new Set([...(current.pendingCosmetics ?? []), pack])],
              },
        );
        feedback('success');
        toast.success(t('cosmetics.asked'));
        return;
      }
      toast.error(errorMessage(error, t));
    },
  });
  const waiting = (pack: CosmeticPack) =>
    teen && plan.data?.pendingCosmetics?.includes(pack) === true;

  const price = priceText(PACK_PRICE, i18n.language);
  const purchase = (pack: CosmeticPack) => {
    if (plan.data === undefined) return null;
    // 15-17: already asked of a parent; it waits until they answer, however often it is opened.
    if (waiting(pack)) {
      return (
        <Text variant="footnote" color="textMuted" testID={`pack-pending-${pack}`}>
          {t('cosmetics.pending')}
        </Text>
      );
    }
    if (!testing) {
      // The words of the Bargu+ screen (plus.soon, plus.teenSoon): one text for "buying comes
      // through Google Play", not a second copy.
      return (
        <Text variant="footnote" color="textMuted">
          {teen ? t('plus.teenSoon') : t('plus.soon')}
        </Text>
      );
    }
    const mutation = teen ? ask : buy;
    return (
      <View style={styles.purchase}>
        <Button
          testID={`pack-buy-${pack}`}
          label={teen ? t('cosmetics.ask', { price }) : t('cosmetics.buy', { price })}
          icon={Sparkles}
          loading={mutation.isPending && mutation.variables === pack}
          onPress={() => {
            mutation.mutate(pack);
          }}
        />
        <View style={styles.test} accessible accessibilityLabel={t('plus.testBand')}>
          <FlaskConical color={colors.textMuted} size={14} strokeWidth={2.25} />
          <Text variant="caption" color="textMuted">
            {t('plus.testBand')}
          </Text>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.section} testID="pin-looks">
      <Text variant="footnote" color="textMuted">
        {t('cosmetics.intro')}
      </Text>
      <View
        testID="pin-look-preview"
        accessible
        accessibilityLabel={t('cosmetics.preview')}
        style={[styles.stage, { backgroundColor: colors.surface }]}
      >
        <AvatarMarker
          name={me?.displayName ?? '?'}
          avatar={me?.avatar ?? null}
          userId={me?.userId}
          look={look}
          lookMine
        />
        <Text variant="subhead" numberOfLines={1}>
          {me?.displayName ?? ''}
        </Text>
      </View>
      {PACKS.map((pack) => {
        const part = PART[pack];
        const has = owned(pack);
        const triedHere = !has && trying[part] !== undefined && trying[part] !== null;
        const styleIds: readonly (RingPattern | FrameStyle)[] = COSMETIC_PACKS[pack];
        const movesHere = styleIds.some((id) =>
          isMoving({
            ring: isRingPattern(id) ? id : undefined,
            frame: isFrameStyle(id) ? id : undefined,
          }),
        );
        return (
          <View
            key={pack}
            testID={`pack-${pack}`}
            style={[styles.card, { backgroundColor: colors.surface }]}
          >
            <View style={styles.head}>
              <Text variant="headline" style={styles.name}>
                {t(`cosmetics.packs.${pack}.name`)}
              </Text>
              {has ? (
                <Badge label={t('cosmetics.owned')} tone="success" />
              ) : waiting(pack) ? (
                <Badge label={t('cosmetics.waiting')} tone="muted" />
              ) : null}
            </View>
            <Text variant="footnote" color="textMuted">
              {t(`cosmetics.packs.${pack}.about`)}
            </Text>
            <View
              accessibilityRole="radiogroup"
              accessibilityLabel={t(`cosmetics.packs.${pack}.name`)}
              style={styles.chips}
            >
              {[null, ...styleIds].map((id) => {
                const selected = shown[part] === id;
                return (
                  <PressableScale
                    key={id ?? 'plain'}
                    testID={`style-${id ?? `${pack}-plain`}`}
                    haptic="select"
                    accessibilityRole="radio"
                    accessibilityLabel={
                      id === null ? t('cosmetics.plain') : t(`cosmetics.styles.${id}`)
                    }
                    accessibilityState={{ selected }}
                    onPress={() => {
                      pick(pack, id);
                    }}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: selected ? colors.primarySoft : colors.surfaceRaised,
                        borderColor: selected ? colors.primary : colors.border,
                      },
                    ]}
                  >
                    <Text variant="subhead" color={selected ? 'primary' : 'text'}>
                      {id === null ? t('cosmetics.plain') : t(`cosmetics.styles.${id}`)}
                    </Text>
                  </PressableScale>
                );
              })}
            </View>
            {movesHere ? <Hint>{t('cosmetics.moves')}</Hint> : null}
            {triedHere ? (
              <Text variant="footnote" color="textMuted" testID={`pack-trying-${pack}`}>
                {t('cosmetics.trying')}
              </Text>
            ) : null}
            {has ? null : purchase(pack)}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.md },
  stage: {
    alignItems: 'center',
    gap: space.sm,
    paddingTop: space.xxl,
    paddingBottom: space.lg,
    borderRadius: radius.lg,
  },
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
  },
  name: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  chip: {
    minHeight: touchTarget - space.xs,
    paddingHorizontal: space.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  purchase: { gap: space.xs },
  test: { flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'center' },
});
