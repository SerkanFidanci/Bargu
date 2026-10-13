import type { Avatar as AvatarData } from '@bargu/schemas';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ambient, elevation, radius, space, useTheme } from '@/theme';

import { Avatar } from './avatar';
import { Text } from './text';

export interface AvatarMarkerProps {
  name: string;
  avatar: AvatarData | null;
  /** Minutes since the last location; set when the position is stale (shown grey with the age). */
  staleMinutes?: number | undefined;
}

/**
 * A person on the map: avatar on a small pin, gently "breathing" while their location is live
 * (BARGU_PLAN §4.3). Stale locations turn grey and show their age; Reduce Motion stops the loop.
 */
export function AvatarMarker({ name, avatar, staleMinutes }: AvatarMarkerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const stale = staleMinutes !== undefined;
  const breath = useSharedValue(0);

  useEffect(() => {
    if (reduced || stale) {
      cancelAnimation(breath);
      breath.set(0);
      return;
    }
    breath.set(
      withRepeat(
        withTiming(1, { duration: ambient.breathe.duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(breath);
    };
  }, [breath, reduced, stale]);

  const breathing = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.get() * (ambient.breathe.scale - 1) }],
  }));

  const label = stale
    ? t('ui.marker.stale', { name, minutes: staleMinutes })
    : t('ui.marker.live', { name });

  return (
    <View accessible accessibilityLabel={label} style={styles.container}>
      <Animated.View
        style={[
          styles.bubble,
          { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
          breathing,
        ]}
      >
        <Avatar avatar={avatar} name={name} size="md" muted={stale} />
      </Animated.View>
      <View style={[styles.tail, { borderTopColor: colors.surfaceRaised }]} />
      {stale ? (
        <View style={[styles.age, { backgroundColor: colors.surfaceRaised }]}>
          <Text variant="caption" color="textMuted" allowFontScaling={false}>
            {t('ui.marker.age', { minutes: staleMinutes })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const TAIL = space.sm;

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  bubble: { padding: space.xxs, borderRadius: radius.pill },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: TAIL / 2 + 1,
    borderRightWidth: TAIL / 2 + 1,
    borderTopWidth: TAIL,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  age: {
    marginTop: space.xxs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
});
