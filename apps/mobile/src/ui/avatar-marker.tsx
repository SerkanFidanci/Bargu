import type { Avatar as AvatarData } from '@bargu/schemas';
import { Zap } from 'lucide-react-native';
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

import { ambient, avatarSize, elevation, radius, space, useTheme } from '@/theme';

import { Avatar } from './avatar';
import { Text } from './text';

export interface AvatarMarkerProps {
  name: string;
  avatar: AvatarData | null;
  /** Minutes since the last location; set when the position is stale (shown grey with the age). */
  staleMinutes?: number | undefined;
  /** Their phone is charging: a small bolt. */
  charging?: boolean | undefined;
  /** Their battery is nearly empty (not charging): a red ring pulses. */
  lowBattery?: boolean | undefined;
}

const TAIL = space.sm;
const BUBBLE = avatarSize.md + space.xxs * 2;
/** From the top of the bubble to the tip of the pin (the person's position). */
export const PIN_HEIGHT = BUBBLE + TAIL - 1;
const BADGE = space.lg;

function useLoop(active: boolean, duration: number) {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    progress.set(
      withRepeat(withTiming(1, { duration, easing: Easing.inOut(Easing.sin) }), -1, true),
    );
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, reduced, active, duration]);
  return progress;
}

/**
 * A person on the map: avatar on a small pin, gently "breathing" while their location is live
 * (BARGU_PLAN §4.3). Ambient states without text: a bolt while charging, a pulsing red ring when
 * the battery is low, grey with the age when the location is old. Reduce Motion stops the loops.
 */
export function AvatarMarker({
  name,
  avatar,
  staleMinutes,
  charging = false,
  lowBattery = false,
}: AvatarMarkerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const stale = staleMinutes !== undefined;
  const breath = useLoop(!stale, ambient.breathe.duration);
  const pulse = useLoop(lowBattery && !charging && !stale, ambient.pulse.duration);

  const breathing = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.get() * (ambient.breathe.scale - 1) }],
  }));
  const pulsing = useAnimatedStyle(() => ({
    opacity: 1 - pulse.get() * (1 - ambient.pulse.minOpacity),
    transform: [{ scale: 1 + pulse.get() * (ambient.breathe.scale - 1) * 2 }],
  }));

  // Over an hour old: in hours ("3 sa"), which reads faster than a large number of minutes.
  const hours = stale && staleMinutes >= 60 ? Math.floor(staleMinutes / 60) : null;
  const where = !stale
    ? t('ui.marker.live', { name })
    : hours === null
      ? t('ui.marker.stale', { name, minutes: staleMinutes })
      : t('ui.marker.staleHours', { name, hours });
  const battery = charging
    ? t('ui.marker.charging')
    : lowBattery
      ? t('ui.marker.lowBattery')
      : null;
  const label = battery === null ? where : `${where}, ${battery}`;

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
        {lowBattery && !charging && !stale ? (
          <Animated.View style={[styles.ring, { borderColor: colors.danger }, pulsing]} />
        ) : null}
        {charging && !stale ? (
          <View
            style={[
              styles.badge,
              { backgroundColor: colors.success, borderColor: colors.surfaceRaised },
            ]}
          >
            <Zap color={colors.onSuccess} fill={colors.onSuccess} size={10} strokeWidth={2} />
          </View>
        ) : null}
      </Animated.View>
      <View style={[styles.tail, { borderTopColor: colors.surfaceRaised }]} />
      {stale ? (
        <View style={[styles.age, { backgroundColor: colors.surfaceRaised }]}>
          <Text variant="caption" color="textMuted" allowFontScaling={false}>
            {hours === null
              ? t('ui.marker.age', { minutes: staleMinutes })
              : t('ui.marker.ageHours', { hours })}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center' },
  bubble: { padding: space.xxs, borderRadius: radius.pill },
  ring: {
    position: 'absolute',
    top: -space.xxs,
    left: -space.xxs,
    width: BUBBLE + space.xxs * 2,
    height: BUBBLE + space.xxs * 2,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  badge: {
    position: 'absolute',
    right: -space.xxs,
    bottom: -space.xxs,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: space.xxs,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
