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

import {
  activityFx,
  ambient,
  avatarPalette,
  avatarSize,
  elevation,
  radius,
  space,
  stickerFx,
  stickerPaper,
  useTheme,
} from '@/theme';

import { Avatar } from './avatar';
import { ActivityGlyph, GLYPH } from './activity-glyph';
import { gaitPose, leanSideOf } from './gait';
import { stickerTilt } from './sticker';
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
  /**
   * The island in their colour under the sticker, on the exact position. Off when several people
   * stand together: their islands are drawn as one (features/map/cluster-bubble.tsx).
   */
  island?: boolean | undefined;
}

/** What someone seems to be doing (features/map/activity.ts decides). */
export type MarkerActivity = 'still' | 'settled' | 'walking' | 'running' | 'cycling' | 'driving';

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

/** The sticker: the avatar with its white die-cut edge. */
export const STICKER = avatarSize.md + stickerFx.edge * 2;
/** From the top of the sticker to the centre of its island: the person's exact position. */
export const PIN_HEIGHT = STICKER + stickerFx.rise;
const ISLAND = stickerFx.island;
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
 * A person on the map (proje sahibi 2026-10-16: "sıradan bir şey yapma"): their avatar as a white
 * die-cut sticker, tilted their own way, floating just above a small island in their colour that
 * sits on the exact position. While the location is live and they stand still the sticker floats
 * gently up and down and its island shrinks under it; moving, it moves the way they move, with a
 * small drawing of what they are doing (activity-glyph.tsx) (BARGU_PLAN §4.3). Ambient states
 * without text: a bolt while charging, a pulsing red ring when the battery is low, grey with the
 * age when the location is old, a slow ripple from the island once settled somewhere. Reduce
 * Motion stops the loops.
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
  island = true,
}: AvatarMarkerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const stale = staleMinutes !== undefined;
  const tint = stale ? colors.textMuted : (avatarPalette[avatar?.color ?? 0] ?? colors.primary);
  const tilt = stickerTilt(userId ?? name);
  const doing: MarkerActivity = stale ? 'still' : activity;
  const moving = doing !== 'still' && doing !== 'settled';
  const breath = useLoop(!stale && !moving, ambient.breathe.duration);
  const cycle = useCycle(periodOf(doing));
  const pulse = useLoop(lowBattery && !charging && !stale, ambient.pulse.duration);

  // Live and still: the sticker floats a little above its island, which shrinks under it.
  const floating = useAnimatedStyle(() => ({
    transform: [{ translateY: -breath.get() * stickerFx.float.lift }],
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
  // The island under a sticker in the air (a step, a float) is smaller and lighter.
  const ground = useAnimatedStyle(() => {
    const lift =
      doing === 'walking' || doing === 'running'
        ? gaitPose(cycle.get(), doing === 'walking' ? activityFx.walk : activityFx.run, 0).lift
        : 0;
    const shrink = lift * activityFx.shadow.shrink + breath.get() * stickerFx.float.shrink;
    return {
      opacity: ISLAND.opacity * (1 - lift * 0.5),
      transform: [{ scaleX: 1 - shrink }, { scaleY: 1 - shrink }],
    };
  });
  // Settled in one place: a slow ripple spreading from the island.
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
  // Drawn figures face east by default; west-bound people get them mirrored.
  const facing: 1 | -1 = leanSide < -0.2 ? -1 : 1;

  return (
    <View accessible accessibilityLabel={label} style={styles.container}>
      {island ? (
        <View style={styles.islandSlot} pointerEvents="none">
          <Animated.View style={[styles.ripple, { borderColor: tint }, ripple]} />
          <Animated.View style={[styles.island, { backgroundColor: tint }, ground]} />
          <View style={[styles.core, { backgroundColor: tint }]} />
        </View>
      ) : null}
      <Animated.View style={[styles.pin, motion]}>
        <Animated.View style={floating}>
          <Animated.View
            style={[
              styles.sticker,
              { backgroundColor: stickerPaper, boxShadow: elevation.raised },
              { transform: [{ rotate: `${String(tilt)}deg` }] },
            ]}
          >
            <Avatar avatar={avatar} name={name} size="md" muted={stale} userId={userId} />
            {doing === 'still' ? null : (
              <View
                style={[
                  styles.activity,
                  { backgroundColor: colors.surfaceRaised, boxShadow: elevation.raised },
                ]}
              >
                <ActivityGlyph activity={doing} phase={cycle} facing={facing} />
              </View>
            )}
            {lowBattery && !charging && !stale ? (
              <Animated.View style={[styles.ring, { borderColor: colors.danger }, pulsing]} />
            ) : null}
            {charging && !stale ? (
              <View
                style={[
                  styles.badge,
                  { backgroundColor: colors.success, borderColor: stickerPaper },
                ]}
              >
                <Zap color={colors.onSuccess} fill={colors.onSuccess} size={10} strokeWidth={2} />
              </View>
            ) : null}
          </Animated.View>
        </Animated.View>
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
  // Tall enough for the island under the sticker; the age label hangs below it.
  container: { alignItems: 'center', minHeight: PIN_HEIGHT + ISLAND.height / 2 },
  // Rotations and squash pivot on the sticker's lower edge, right above the person's position.
  pin: { alignItems: 'center', transformOrigin: '50% 100%' },
  islandSlot: {
    position: 'absolute',
    top: PIN_HEIGHT - ISLAND.height / 2,
    left: -ISLAND.width,
    right: -ISLAND.width,
    height: ISLAND.height,
    alignItems: 'center',
    justifyContent: 'center',
  },
  island: {
    position: 'absolute',
    width: ISLAND.width,
    height: ISLAND.height,
    borderRadius: radius.pill,
  },
  core: {
    width: ISLAND.core,
    height: ISLAND.core / 2,
    borderRadius: radius.pill,
  },
  ripple: {
    position: 'absolute',
    width: ISLAND.width,
    height: ISLAND.height,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  // The activity drawing sits on the bubble's upper corner, big enough to read its motion.
  activity: {
    position: 'absolute',
    right: -GLYPH / 2,
    top: -GLYPH / 2 + space.xs,
    width: GLYPH + space.xs,
    height: GLYPH + space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  sticker: { padding: stickerFx.edge, borderRadius: radius.pill },
  ring: {
    position: 'absolute',
    top: -space.xxs,
    left: -space.xxs,
    width: STICKER + space.xxs * 2,
    height: STICKER + space.xxs * 2,
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
  age: {
    marginTop: stickerFx.rise + ISLAND.height / 2 + space.xxs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
});
