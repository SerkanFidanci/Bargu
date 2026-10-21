import type { Avatar as AvatarData } from '@bargu/schemas';
import type { TFunction } from 'i18next';
import { Zap } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
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
  pinFx,
  radius,
  space,
  useTheme,
} from '@/theme';
import { type EffectLevel, repeatFinite, useEffects } from '@/theme/effects';

import { Avatar } from './avatar';
import { ActivityGlyph, BADGE_ROUND, BADGE_WIDE, wideGlyph } from './activity-glyph';
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
  /** m/s, when their location carries it: a vehicle's wheels and road go with it. */
  speed?: number | null | undefined;
  /**
   * In a pin shared with others (features/map/cluster-bubble.tsx): only the avatar and its signs;
   * the shared pin draws the ring, the tail and the dot on the position.
   */
  framed?: boolean | undefined;
  /** Their speed or how long they have stayed, on a line under the island (live locations only). */
  detail?: MarkerDetail | undefined;
  /** When their latest location came: at sade mod "reduced" each one plays the motion once. */
  news?: number | undefined;
}

/** What someone seems to be doing (features/map/activity.ts decides). */
export type MarkerActivity =
  | 'still'
  | 'settled'
  | 'walking'
  | 'running'
  | 'cycling'
  | 'driving'
  | 'racing'
  | 'train'
  | 'plane';

/** The line under someone (features/map/motion-detail.ts decides). */
export type MarkerDetail =
  | { kind: 'speed'; kmh: number }
  | { kind: 'stay'; unit: 'minutes' | 'hours' | 'days'; count: number };

/** The line as written ("42 km/sa", "2 sa") or as read aloud ("saatte 42 km"). */
export function markerDetailText(detail: MarkerDetail, t: TFunction, spoken = false): string {
  const key =
    detail.kind === 'speed'
      ? 'speed'
      : detail.unit === 'minutes'
        ? 'stayMinutes'
        : detail.unit === 'hours'
          ? 'stayHours'
          : 'stayDays';
  // Not `count`: that would look for plural forms, which the texts avoid (i18n.test.ts).
  const n = detail.kind === 'speed' ? detail.kmh : detail.count;
  return t(`ui.marker.detail.${spoken ? 'spoken' : 'short'}.${key}`, { n });
}

/**
 * The loop that drives an activity's motion, one cycle per period (docs/ADR/0027): endlessly at
 * sade mod "full" (the map lively, the project owner's wish), once per new location at "reduced",
 * never at "off".
 */
function useCycle(periodMs: number | null, level: EffectLevel, news: number | undefined) {
  const phase = useSharedValue(0);
  const again = level === 'reduced' ? news : undefined;
  useEffect(() => {
    cancelAnimation(phase);
    phase.set(0);
    if (level === 'off' || periodMs === null) return;
    const once = withTiming(1, { duration: periodMs, easing: Easing.linear });
    phase.set(level === 'full' ? withRepeat(once, -1, false) : once);
    return () => {
      cancelAnimation(phase);
    };
  }, [phase, level, periodMs, again]);
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
    case 'racing':
    case 'train':
    case 'plane':
      return activityFx.drive.periodMs;
    case 'settled':
      return activityFx.settled.rippleMs;
    case 'still':
      return null;
  }
}

/** The pin's circle: the avatar in its ring. */
export const PIN_CIRCLE = avatarSize.md + pinFx.ring * 2;
/** From the top of the circle to the dot on the person's exact position. */
export const PIN_HEIGHT = PIN_CIRCLE + pinFx.tail;
const BADGE = space.lg;
/** The drawing inside the activity badge keeps this far from its edge (px). */
const BADGE_INSET = 1;

/** A there-and-back loop (breathing, a pulse): as useCycle, once per new location when reduced. */
function useLoop(active: boolean, duration: number, level: EffectLevel, news: number | undefined) {
  const progress = useSharedValue(0);
  const again = level === 'reduced' ? news : undefined;
  useEffect(() => {
    if (level === 'off' || !active) {
      cancelAnimation(progress);
      progress.set(0);
      return;
    }
    const half = withTiming(1, { duration, easing: Easing.inOut(Easing.sin) });
    progress.set(level === 'full' ? withRepeat(half, -1, true) : repeatFinite(half, 1, true));
    return () => {
      cancelAnimation(progress);
    };
  }, [progress, level, active, duration, again]);
  return progress;
}

/**
 * A person on the map as a pin (the project owner, 2026-10-18): their avatar in a violet ring (grey
 * when the location is old), a short tail down to a dot on the exact position, and a green dot on
 * the circle while the location is fresh. While live and still the pin floats gently above its
 * dot; moving, it moves the way they move, with a small drawing of what they are doing
 * (activity-glyph.tsx) (BARGU_PLAN §4.3). Ambient states without text: a bolt while charging, a
 * pulsing red ring when the battery is low, grey with the age when the location is old, a slow
 * ripple from the dot once settled somewhere. Sade mod scales the loops (useCycle); Reduce Motion
 * stops them.
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
  speed,
  framed = false,
  detail,
  news,
}: AvatarMarkerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const stale = staleMinutes !== undefined;
  const ring = stale ? colors.textMuted : colors.primary;
  const doing: MarkerActivity = stale ? 'still' : activity;
  const moving = doing !== 'still' && doing !== 'settled';
  const level = useEffects();
  const breath = useLoop(!stale && !moving, ambient.breathe.duration, level, news);
  const cycle = useCycle(periodOf(doing), level, news);
  const pulse = useLoop(lowBattery && !charging && !stale, ambient.pulse.duration, level, news);

  // Live and still: the pin floats a little above its dot.
  const floating = useAnimatedStyle(() => ({
    transform: [{ translateY: -breath.get() * pinFx.float.lift }],
  }));
  const leanSide = leanSideOf(heading);
  // Walking and running: a real gait (gait.ts); a bike sways; a vehicle hums.
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
    } else if (moving) {
      const hum = Math.sin(cycle.get() * 2 * Math.PI * activityFx.drive.bobs);
      pose = { ...pose, y: hum * activityFx.drive.lift };
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
  // Settled in one place: a slow ripple spreading from the dot.
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
  // An old location says its age instead: its speed or stay would no longer be true. In a shared
  // frame there is no room under each one (the group's window lists it, together-sheet.tsx).
  const line = stale || framed || detail === undefined ? null : detail;
  const label = [where, doingLabel, line === null ? null : markerDetailText(line, t, true), battery]
    .filter((part) => part !== null)
    .join(', ');
  // Drawn figures face east by default; west-bound people get them mirrored.
  const facing: 1 | -1 = leanSide < -0.2 ? -1 : 1;
  // Wheels, rails and wings get a wide badge, except in a shared pin (no room beside a neighbour).
  const wide = !framed && doing !== 'still' && wideGlyph(doing);

  return (
    <View accessible accessibilityLabel={label} style={styles.container}>
      {framed ? null : (
        <View style={styles.dotSlot} pointerEvents="none">
          <Animated.View style={[styles.ripple, { borderColor: ring }, ripple]} />
          <View
            style={[styles.dot, { backgroundColor: ring, borderColor: colors.surfaceRaised }]}
          />
        </View>
      )}
      <Animated.View style={[styles.pin, motion]}>
        <Animated.View style={[styles.pin, floating]}>
          <View
            style={[
              styles.circle,
              framed
                ? null
                : {
                    borderColor: ring,
                    backgroundColor: colors.surfaceRaised,
                    boxShadow: elevation.raised,
                  },
            ]}
          >
            <Avatar avatar={avatar} name={name} size="md" muted={stale} userId={userId} />
            {doing === 'still' ? null : (
              <View
                style={[
                  styles.activity,
                  wide ? styles.activityWide : null,
                  { backgroundColor: colors.surfaceRaised, boxShadow: elevation.raised },
                ]}
              >
                <ActivityGlyph
                  activity={doing}
                  phase={cycle}
                  facing={facing}
                  speed={speed}
                  paint={avatarPalette[avatar?.color ?? 0] ?? colors.primary}
                  width={(wide ? BADGE_WIDE.width : BADGE_ROUND) - BADGE_INSET * 2}
                  height={(wide ? BADGE_WIDE.height : BADGE_ROUND) - BADGE_INSET * 2}
                />
              </View>
            )}
            {lowBattery && !charging && !stale ? (
              <Animated.View style={[styles.lowBattery, { borderColor: colors.danger }, pulsing]} />
            ) : null}
            {charging && !stale ? (
              <View
                style={[
                  styles.badge,
                  styles.charging,
                  { backgroundColor: colors.success, borderColor: colors.surfaceRaised },
                ]}
              >
                <Zap color={colors.onSuccess} fill={colors.onSuccess} size={10} strokeWidth={2} />
              </View>
            ) : null}
            {stale ? null : (
              <View
                testID="marker-live"
                style={[
                  styles.live,
                  { backgroundColor: colors.success, borderColor: colors.surfaceRaised },
                ]}
              />
            )}
          </View>
          {framed ? null : <View style={[styles.tail, { borderTopColor: ring }]} />}
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
      ) : line !== null ? (
        <View
          testID="marker-detail"
          style={[
            styles.age,
            { backgroundColor: colors.surfaceRaised, boxShadow: elevation.raised },
          ]}
        >
          <Text variant="caption" allowFontScaling={false}>
            {markerDetailText(line, t)}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Tall enough for the pin down to its dot; the age (or speed, or stay) hangs below it.
  container: { alignItems: 'center', minHeight: PIN_HEIGHT + pinFx.dot / 2 },
  // Rotations and squash pivot on the tail's tip, the person's position.
  pin: { alignItems: 'center', transformOrigin: '50% 100%' },
  dotSlot: {
    position: 'absolute',
    top: PIN_HEIGHT - pinFx.dot / 2,
    width: pinFx.dot,
    height: pinFx.dot,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: pinFx.dot,
    height: pinFx.dot,
    borderRadius: radius.pill,
    borderWidth: pinFx.ring / 2,
  },
  ripple: {
    position: 'absolute',
    width: PIN_CIRCLE / 2,
    height: PIN_CIRCLE / 2,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  circle: {
    width: PIN_CIRCLE,
    height: PIN_CIRCLE,
    borderRadius: radius.pill,
    borderWidth: pinFx.ring,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // A downward triangle from the circle to the dot.
  tail: {
    width: 0,
    height: 0,
    marginTop: -pinFx.ring / 2,
    borderLeftWidth: pinFx.tailWidth / 2,
    borderRightWidth: pinFx.tailWidth / 2,
    borderTopWidth: pinFx.tail + pinFx.ring / 2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  // The activity drawing sits on the circle's upper corner, big enough to read its motion.
  activity: {
    position: 'absolute',
    right: -BADGE_ROUND / 2 + space.xxs,
    top: -BADGE_ROUND / 2 + space.xs + space.xxs,
    width: BADGE_ROUND,
    height: BADGE_ROUND,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // A vehicle's badge reaches out to the right of the circle, as in the approved preview.
  activityWide: {
    right: -(BADGE_WIDE.width - BADGE_ROUND / 2 - space.xxs),
    top: -BADGE_WIDE.height / 2 + space.xxs,
    width: BADGE_WIDE.width,
    height: BADGE_WIDE.height,
  },
  lowBattery: {
    position: 'absolute',
    top: -pinFx.ring - space.xxs,
    left: -pinFx.ring - space.xxs,
    width: PIN_CIRCLE + space.xxs * 2,
    height: PIN_CIRCLE + space.xxs * 2,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  badge: {
    position: 'absolute',
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    borderWidth: space.xxs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Charging on the lower left: the lower right is the live dot's.
  charging: { left: -space.xs, bottom: -space.xs },
  live: {
    position: 'absolute',
    right: -space.xxs,
    bottom: -space.xxs,
    width: pinFx.live,
    height: pinFx.live,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  age: {
    marginTop: pinFx.dot / 2 + space.xs,
    paddingHorizontal: space.sm,
    borderRadius: radius.pill,
  },
});
