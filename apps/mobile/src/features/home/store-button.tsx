import { router } from 'expo-router';
import { ShoppingBag } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { duration, elevation, radius, space, storeFx, touchTarget, useTheme } from '@/theme';
import { type EffectLevel, repeatFinite, timesAt } from '@/theme/effects';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { usePlan } from '../billing/plan';
import { daysLeft } from '../billing/plan-model';
import { useNow } from '../location/clock';

/**
 * The store's own advert at the top of the map's right edge (the owner, 2026-10-27: "sağ tarafta
 * yine mağaza butonu olsun ama belirgin kendi reklamımızmış gibi"; docs/ADR/0025 Ek 2): a violet to
 * magenta band, a bag, "Mağaza" and a line that fits the account (Bargu+ for those without it, the
 * pin looks for those with it). A light crosses it a few times when the map shows, then it rests.
 */
export function StoreButton({ level }: { level: EffectLevel }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const plan = usePlan().data;
  const tagline =
    plan === undefined || plan.plan === 'plus'
      ? t('store.button.plus')
      : plan.plan === 'trial' && plan.trialEndsAt !== null
        ? t('store.button.trial', { days: daysLeft(plan.trialEndsAt, now) })
        : t('store.button.free');

  const width = useSharedValue(0);
  const shine = useSharedValue(0);
  const times = timesAt(level, storeFx.shines);
  useEffect(() => {
    if (times === 0) return undefined;
    // Each crossing waits first, so the last one ends the animation: nothing runs after it.
    shine.value = repeatFinite(
      withSequence(
        withDelay(storeFx.gap, withTiming(0, { duration: duration.instant })),
        withTiming(1, { duration: storeFx.duration, easing: Easing.inOut(Easing.quad) }),
      ),
      times,
    );
    return () => {
      cancelAnimation(shine);
    };
  }, [shine, times]);
  const light = useAnimatedStyle(() => ({
    opacity: shine.value > 0 && shine.value < 1 ? 1 : 0,
    transform: [
      { translateX: -storeFx.width * 2 + shine.value * (width.value + storeFx.width * 3) },
      { rotate: `${String(storeFx.slant)}deg` },
    ],
  }));

  return (
    <PressableScale
      testID="shortcut-store"
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={t('store.button.a11y', { tagline })}
      onPress={() => {
        router.push('/store');
      }}
      onLayout={(event) => {
        width.value = event.nativeEvent.layout.width;
      }}
      style={[styles.pill, { boxShadow: elevation.raised }]}
    >
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id="store-band" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={colors.primary} />
            <Stop offset="1" stopColor={colors.promo} />
          </LinearGradient>
        </Defs>
        <Rect width="100%" height="100%" fill="url(#store-band)" />
      </Svg>
      <Animated.View
        pointerEvents="none"
        style={[styles.light, { backgroundColor: colors.promoShine }, light]}
      />
      <ShoppingBag color={colors.onPromo} size={touchTarget * 0.42} strokeWidth={2.25} />
      <View style={styles.words}>
        <Text variant="headline" color="onPromo" numberOfLines={1}>
          {t('store.button.label')}
        </Text>
        <Text variant="caption" color="onPromo" numberOfLines={1}>
          {tagline}
        </Text>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.md,
    paddingRight: space.lg,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  light: {
    position: 'absolute',
    left: 0,
    top: -touchTarget,
    bottom: -touchTarget,
    width: storeFx.width,
  },
  words: { flexShrink: 1 },
});
