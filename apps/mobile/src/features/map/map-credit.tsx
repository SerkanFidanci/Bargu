import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import Animated, {
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

import { ambient, radius, space, timing, useTheme } from '@/theme';
import { Text } from '@/ui/text';

/**
 * OpenStreetMap credit, shown when the map opens and folded away after a few seconds, as the
 * OSMF attribution guidelines allow; the licence stays reachable in the Me sheet (Map data).
 */
export function MapCredit({ bottom }: { bottom: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const opacity = useSharedValue(1);

  useEffect(() => {
    opacity.set(withDelay(ambient.mapCredit, withTiming(0, timing.slow), ReduceMotion.Never));
  }, [opacity]);

  const style = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.credit, { bottom, backgroundColor: colors.surfaceRaised }, style]}
    >
      <Text variant="caption" color="textMuted" maxFontSizeMultiplier={1.5}>
        {t('main.mapCredit')}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  credit: {
    position: 'absolute',
    left: space.lg,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
  },
});
