import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  interpolate,
  useAnimatedRef,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  GhostIllustration,
  LockedIllustration,
  PrecisionIllustration,
} from '@/features/onboarding/intro-illustrations';
import { choreography, radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

const PAGES = [
  { key: 'locked', Illustration: LockedIllustration },
  { key: 'precision', Illustration: PrecisionIllustration },
  { key: 'ghost', Illustration: GhostIllustration },
] as const;

const DOT = space.sm;

/** Three cards that explain the promise before asking for anything (BARGU_PLAN §4.3). */
export default function WelcomeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const scroller = useAnimatedRef<Animated.ScrollView>();
  const offset = useSharedValue(0);
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  const onScroll = useAnimatedScrollHandler((event) => {
    offset.set(event.contentOffset.x);
  });

  const next = () => {
    if (last) {
      router.push('/email');
      return;
    }
    scroller.current?.scrollTo({ x: (page + 1) * width, animated: true });
    setPage(page + 1);
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: colors.background }]}>
      <View style={styles.top}>
        <Button
          label={t('intro.skip')}
          variant="ghost"
          fill={false}
          onPress={() => {
            router.push('/email');
          }}
        />
      </View>
      <Animated.ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={(event) => {
          setPage(Math.round(event.nativeEvent.contentOffset.x / width));
        }}
      >
        {PAGES.map(({ key, Illustration }, index) => (
          <View
            key={key}
            style={[styles.page, { width }]}
            accessible
            accessibilityLabel={`${t(`intro.${key}.title`)}. ${t(`intro.${key}.body`)}`}
            accessibilityHint={t('intro.page', { current: index + 1, total: PAGES.length })}
          >
            <Parallax
              index={index}
              offset={offset}
              width={width}
              depth={choreography.parallax.illustration}
            >
              <Illustration active={index === page} />
            </Parallax>
            <Parallax
              index={index}
              offset={offset}
              width={width}
              depth={choreography.parallax.text}
            >
              <Text variant="title1" align="center" accessibilityRole="header">
                {t(`intro.${key}.title`)}
              </Text>
              <Text variant="callout" color="textMuted" align="center">
                {t(`intro.${key}.body`)}
              </Text>
            </Parallax>
          </View>
        ))}
      </Animated.ScrollView>
      <View style={styles.footer}>
        <View style={styles.dots} importantForAccessibility="no-hide-descendants">
          {PAGES.map(({ key }, index) => (
            <Dot key={key} index={index} offset={offset} width={width} />
          ))}
        </View>
        <Button label={last ? t('intro.start') : t('intro.next')} onPress={next} haptic="select" />
      </View>
    </SafeAreaView>
  );
}

/** A layer of an intro page that drifts behind the swipe and fades with distance. */
function Parallax({
  index,
  offset,
  width,
  depth,
  children,
}: {
  index: number;
  offset: SharedValue<number>;
  width: number;
  depth: number;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const style = useAnimatedStyle(() => {
    const distance = offset.get() - index * width;
    const progress = Math.abs(distance) / Math.max(width, 1);
    return {
      opacity: interpolate(progress, [0, 0.8], [1, 0], 'clamp'),
      transform: [{ translateX: reduced ? 0 : distance * depth }],
    };
  });
  return <Animated.View style={[styles.layer, style]}>{children}</Animated.View>;
}

function Dot({
  index,
  offset,
  width,
}: {
  index: number;
  offset: SharedValue<number>;
  width: number;
}) {
  const { colors } = useTheme();
  const style = useAnimatedStyle(() => {
    const distance = Math.abs(offset.get() / Math.max(width, 1) - index);
    return {
      width: interpolate(distance, [0, 1], [DOT * 3, DOT], 'clamp'),
      opacity: interpolate(distance, [0, 1], [1, 0.35], 'clamp'),
    };
  });
  return <Animated.View style={[styles.dot, { backgroundColor: colors.primary }, style]} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { alignItems: 'flex-end', paddingHorizontal: space.lg },
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.lg,
    paddingHorizontal: space.xxl,
  },
  footer: { paddingHorizontal: space.xl, paddingBottom: space.lg, gap: space.xl },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: space.sm },
  dot: { height: DOT, borderRadius: radius.pill },
  layer: { alignItems: 'center', gap: space.lg },
});
