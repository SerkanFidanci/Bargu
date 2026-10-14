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

import { activityFx, ambient, avatarSize, elevation, radius, space, useTheme } from '@/theme';

import { Avatar } from './avatar';
import { gaitPose, leanSideOf } from './gait';
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
  /** Whose marker: their profile photo shows when this phone has it. */
  userId?: string | undefined;
  /** What they seem to be doing: the pin moves accordingly and a small badge says it. */
  activity?: MarkerActivity | undefined;
  /** Degrees from north while moving: they lean that way and the badge faces it. */
  heading?: number | null | undefined;
}

/** What someone seems to be doing (features/map/activity.ts decides). */
export type MarkerActivity = 'still' | 'settled' | 'walking' | 'running' | 'cycling' | 'driving';

const ACTIVITY_BADGE: Record<MarkerActivity, string | null> = {
  still: null,
  settled: '📍',
  walking: '🚶',
  running: '🏃',
  cycling: '🚴',
  driving: '🚗',
};

/** The loop that drives an activity's motion: one cycle per period, endlessly. */
function useCycle(periodMs: number | null) {
  const reduced = useReducedMotion();
  const phase = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(phase);
    phase.set(0);
    if (reduced || periodMs === null) return;
    phase.set(withRepeat(withTiming(1, { duration: periodMs, easing: Easing.linear }), -1, false));
    return () => {
      cancelAnimation(phase);
    };
  }, [phase, reduced, periodMs]);
  return phase;
}

function periodOf(activity: MarkerActivity): number | null {
  switch (activity) {
    case 'walking':
      return activityFx.walk.cycleMs;
    case 'running':
      return activityFx.run.cycleMs;
    case 'cycling':
      return activityFx.bike.periodMs;
    case 'driving':
      return activityFx.drive.periodMs;
    case 'settled':
      return activityFx.settled.rippleMs;
    case 'still':
      return null;
  }
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
  userId,
  activity = 'still',
  heading,
}: AvatarMarkerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const stale = staleMinutes !== undefined;
  const doing: MarkerActivity = stale ? 'still' : activity;
  const moving = doing !== 'still' && doing !== 'settled';
  const breath = useLoop(!stale && !moving, ambient.breathe.duration);
  const cycle = useCycle(periodOf(doing));
  const pulse = useLoop(lowBattery && !charging && !stale, ambient.pulse.duration);

  const breathing = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.get() * (ambient.breathe.scale - 1) }],
  }));
  const leanSide = leanSideOf(heading);
  // Walking and running: a real gait (gait.ts); a bike sways; a car hums.
  const motion = useAnimatedStyle(() => {
    let pose = { x: 0, y: 0, rotate: 0, scaleX: 1, scaleY: 1 };
    if (doing === 'walking' || doing === 'running') {
      pose = gaitPose(
        cycle.get(),
        doing === 'walking' ? activityFx.walk : activityFx.run,
        leanSide,
      );
    } else if (doing === 'cycling') {
      const wave = Math.sin(cycle.get() * 2 * Math.PI);
      pose = { ...pose, x: wave * activityFx.bike.sway, rotate: wave * activityFx.bike.tilt };
    } else if (doing === 'driving') {
      pose = { ...pose, y: Math.sin(cycle.get() * 2 * Math.PI) * activityFx.drive.lift };
    }
    return {
      transform: [
        { translateX: pose.x },
        { translateY: pose.y },
        { rotate: `${String(pose.rotate)}deg` },
        { scaleX: pose.scaleX },
        { scaleY: pose.scaleY },
      ],
    };
  });
  // The shadow on the ground under a walking or running pin: smaller and lighter in the air.
  const shadow = useAnimatedStyle(() => {
    if (doing !== 'walking' && doing !== 'running') return { opacity: 0 };
    const { lift } = gaitPose(
      cycle.get(),
      doing === 'walking' ? activityFx.walk : activityFx.run,
      0,
    );
    return {
      opacity: activityFx.shadow.opacity * (1 - lift * 0.5),
      transform: [{ scaleX: 1 - lift * activityFx.shadow.shrink }],
    };
  });
  // Settled in one place: a slow ripple spreading from the pin.
  const ripple = useAnimatedStyle(() => ({
    opacity: doing === 'settled' ? activityFx.settled.opacity * (1 - cycle.get()) : 0,
    transform: [{ scale: 1 + cycle.get() * (activityFx.settled.scale - 1) }],
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
  const doingLabel = doing === 'still' ? null : t(`ui.marker.activity.${doing}`);
  const label = [where, doingLabel, battery].filter((part) => part !== null).join(', ');
  const badge = ACTIVITY_BADGE[doing];
  const faceEast =
    (doing === 'walking' || doing === 'running' || doing === 'cycling') && leanSide > 0.2;

  return (
    <View accessible accessibilityLabel={label} style={styles.container}>
      <View style={styles.shadowSlot} pointerEvents="none">
        <Animated.View style={[styles.shadow, { backgroundColor: colors.scrim }, shadow]} />
      </View>
      <Animated.View style={[styles.pin, motion]}>
        <Animated.View
          style={[styles.ripple, { borderColor: colors.primary }, ripple]}
          pointerEvents="none"
        />
        <Animated.View
          style={[
            styles.bubble,
            { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
            breathing,
          ]}
        >
          <Avatar avatar={avatar} name={name} size="md" muted={stale} userId={userId} />
          {badge === null ? null : (
            <View
              style={[
                styles.activity,
                { backgroundColor: colors.surfaceRaised, boxShadow: elevation.raised },
              ]}
            >
              <Text
                variant="caption"
                allowFontScaling={false}
                // The walker emojis face left: mirrored when heading east, so they face the way.
                style={[styles.activityText, faceEast ? styles.mirrored : null]}
              >
                {badge}
              </Text>
            </View>
          )}
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
      </Animated.View>
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
  // Rotations and squash pivot on the tip: the person stands on their position.
  pin: { alignItems: 'center', transformOrigin: '50% 100%' },
  shadowSlot: {
    position: 'absolute',
    top: PIN_HEIGHT - activityFx.shadow.height / 2,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  shadow: {
    width: activityFx.shadow.width,
    height: activityFx.shadow.height,
    borderRadius: activityFx.shadow.height / 2,
  },
  mirrored: { transform: [{ scaleX: -1 }] },
  ripple: {
    position: 'absolute',
    top: 0,
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  activity: {
    position: 'absolute',
    right: -space.sm,
    top: -space.sm,
    width: BADGE + space.xs,
    height: BADGE + space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityText: { fontSize: space.md, lineHeight: space.lg },
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
