import {
  COSMETIC_PACKS,
  type CosmeticPack,
  type FrameStyle,
  type RingPattern,
} from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Sparkles } from 'lucide-react-native';
import { useState } from 'react';
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
import { SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { ageKey, fetchAge, isMinor } from '../account/age-api';
import { billingApi } from '../billing/billing-api';
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
  PACK_PRICE,
  PACKS,
} from './look-styles';

/** Which part of a look each pack gives. */
const PART = { rings: 'ring', frames: 'frame' } as const satisfies Record<
  CosmeticPack,
  keyof LookChoice
>;

/** Styles being tried: absent (undefined) is not trying, null is trying the plain one. */
interface Trying {
  ring?: string | null | undefined;
  frame?: string | null | undefined;
}

/** What a choice would look like, as far as this app knows its styles (a preview, so not checked). */
function previewOf(choice: LookChoice): Look | undefined {
  const ring = isRingPattern(choice.ring) ? choice.ring : undefined;
  const frame = isFrameStyle(choice.frame) ? choice.frame : undefined;
  return ring === undefined && frame === undefined ? undefined : { ring, frame, until: Infinity };
}

/**
 * "Pin süsleri" in Görünüm ve harita (docs/ADR/0025 and its addendum of 2026-10-21): the user's
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
  // Styles tried from packs not bought: shown on the pin, never saved or sent.
  const [trying, setTrying] = useState<Trying>({});
  const shown: LookChoice = {
    ring: trying.ring === undefined ? choice.ring : trying.ring,
    frame: trying.frame === undefined ? choice.frame : trying.frame,
  };
  const look = previewOf(shown);
  const owned = (pack: CosmeticPack) => plan.data?.cosmetics.includes(pack) === true;
  const testing = plan.data?.testBilling === true;

  const pick = (pack: CosmeticPack, id: string | null) => {
    const part = PART[pack];
    if (!owned(pack)) {
      setTrying((current) => ({ ...current, [part]: id }));
      return;
    }
    setTrying((current) => ({ ...current, [part]: undefined }));
    chooseLook({ ...choice, [part]: id }).catch(() => undefined);
  };

  const buy = useMutation({
    mutationFn: (pack: CosmeticPack) => billingApi.testPurchase(`cosmetic:${pack}`),
    onSuccess: (next, pack) => {
      queryClient.setQueryData(planKey, next);
      // The new pack is in the next pass; the style tried goes to circles with it.
      const part = PART[pack];
      const tried = trying[part];
      setTrying((current) => ({ ...current, [part]: undefined }));
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
      // 15-17: the pack waits for a parent (docs/ADR/0025 §6); the server says so with this code.
      if (isApiError(error, 'GUARDIAN_APPROVAL')) {
        feedback('success');
        toast.info(t('cosmetics.needsApproval'));
        return;
      }
      toast.error(errorMessage(error, t));
    },
  });

  const price = priceText(PACK_PRICE, i18n.language);
  const purchase = (pack: CosmeticPack) => {
    if (plan.data === undefined) return null;
    if (!testing) {
      return (
        <Text variant="footnote" color="textMuted">
          {teen ? t('cosmetics.teenSoon') : t('cosmetics.soon')}
        </Text>
      );
    }
    return (
      <View style={styles.purchase}>
        <Button
          testID={`pack-buy-${pack}`}
          label={teen ? t('cosmetics.ask', { price }) : t('cosmetics.buy', { price })}
          icon={Sparkles}
          loading={buy.isPending && buy.variables === pack}
          onPress={() => {
            buy.mutate(pack);
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
      <SectionTitle>{t('cosmetics.title')}</SectionTitle>
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
              {has ? <Badge label={t('cosmetics.owned')} tone="success" /> : null}
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
