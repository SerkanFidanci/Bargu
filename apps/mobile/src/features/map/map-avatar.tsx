import type { Avatar as AvatarData } from '@bargu/schemas';
import { type ReactNode, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import type { Look } from '@/features/cosmetics/look-styles';
import { avatarPalette, space, spring, timing, useTheme } from '@/theme';
import { AvatarMarker, type MarkerDetail, PIN_HEIGHT } from '@/ui/avatar-marker';

import type { Activity } from './activity';
import { Footprints } from './footprints';
import { trailLevel } from './glide';
import { MeetBurst } from './meet-burst';
import { type PersonHandlers, PersonGestures } from './person-gestures';

/** Dots in a trail and their spacing (px), by trail level (glide.ts trailLevel). */
const TRAIL = {
  1: { dots: 3, gap: space.sm },
  2: { dots: 4, gap: space.md },
  3: { dots: 5, gap: space.lg },
} as const;
const DOT = space.md;
/** The first dot's opacity, and how much of it fades over the trail. */
const TRAIL_OPACITY = { first: 0.55, fade: 0.45 } as const;
/**
 * A fast car, a train or a plane leaves plain lines behind instead of dots (the owner's approved
 * preview): their side offset, length and opacity (px). Nothing more: speed is not celebrated.
 */
const STREAKS = [
  { side: -5, length: 18, opacity: 0.5 },
  { side: 0, length: 26, opacity: 0.42 },
  { side: 5, length: 14, opacity: 0.34 },
] as const;
const STREAK_WIDTH = 2;
/** Room around the position for the longest trail, and above it for the pin. */
const REACH = DOT + TRAIL[3].dots * TRAIL[3].gap;
const BOX = 2 * Math.max(REACH, PIN_HEIGHT + space.xl);
const CENTER = BOX / 2;

export interface MapAvatarProps {
  name: string;
  avatar: AvatarData | null;
  staleMinutes?: number | undefined;
  /** m/s and degrees from north, when moving. */
  spd?: number | null | undefined;
  hdg?: number | null | undefined;
  charging?: boolean | undefined;
  lowBattery?: boolean | undefined;
  /** Drawn above the pin (e.g. a status bubble). */
  above?: ReactNode;
  /** Whose avatar (their profile photo, when this phone has it). */
  userId?: string | undefined;
  /** What they seem to be doing (activity.ts): the pin moves and a badge says it. */
  activity?: Activity | undefined;
  /** Their speed or how long they have stayed, under the pin (motion-detail.ts). */
  detail?: MarkerDetail | undefined;
  /** Tap for the card, hold for the radial menu (others' avatars only). */
  handlers?: PersonHandlers | undefined;
  /** When they last poked this phone: the avatar jumps once. */
  pokedAt?: number | undefined;
  /** A meeting to celebrate around this avatar (meet-burst.tsx). */
  burst?: { at: number; colors: readonly [string, string] } | null | undefined;
  /** When their latest location came (sade mod "reduced" moves once per new one). */
  news?: number | undefined;
  /** What their pass gives them to wear on the pin (features/cosmetics). */
  look?: Look | undefined;
  /** The user's own pin. */
  lookMine?: boolean | undefined;
}

/**
 * The marker view of a person: a fixed square whose centre is exactly their position (the map
 * anchors it at the centre), with the pin's tip on that point and, while they move, footprints
 * (on foot) or a trail of fading dots that grows with their speed (on wheels). The square keeps the anchor true whatever
 * is drawn around the pin (age, trail, status).
 */
export function MapAvatar({
  name,
  avatar,
  staleMinutes,
  spd,
  hdg,
  charging,
  lowBattery,
  above,
  handlers,
  pokedAt,
  burst,
  userId,
  activity,
  detail,
  news,
  look,
  lookMine,
}: MapAvatarProps) {
  const lift = useSharedValue(0);
  useEffect(() => {
    if (pokedAt === undefined) return;
    lift.set(withSequence(withTiming(-space.xl, timing.fast), withSpring(0, spring.bouncy)));
  }, [pokedAt, lift]);
  const jumping = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));
  const heading = staleMinutes === undefined ? hdg : null;
  // On foot: footprints; on wheels: the fading trail that grows with speed.
  const gait = activity === 'walking' ? 'walk' : activity === 'running' ? 'run' : null;
  const fast = activity === 'racing' || activity === 'train' || activity === 'plane';
  const level =
    heading !== null && heading !== undefined && gait === null && !fast ? trailLevel(spd) : 0;
  const { colors } = useTheme();
  const color = avatarPalette[avatar?.color ?? 0] ?? colors.primary;
  const pin = (
    <AvatarMarker
      name={name}
      avatar={avatar}
      staleMinutes={staleMinutes}
      charging={charging}
      lowBattery={lowBattery}
      userId={userId}
      activity={activity}
      heading={hdg}
      speed={spd}
      detail={detail}
      news={news}
      look={look}
      lookMine={lookMine}
    />
  );
  return (
    <View style={styles.box} pointerEvents="box-none">
      {gait === null || heading === null || heading === undefined ? null : (
        <Footprints gait={gait} heading={heading} center={CENTER} color={color} news={news} />
      )}
      {level === 0 ? null : (
        <View
          pointerEvents="none"
          style={[styles.trail, { transform: [{ rotate: `${String(hdg ?? 0)}deg` }] }]}
        >
          {Array.from({ length: TRAIL[level].dots }, (_, index) => {
            const size = DOT - (index * DOT) / (TRAIL[level].dots + 1);
            return (
              <View
                key={index}
                style={[
                  styles.dot,
                  {
                    width: size,
                    height: size,
                    borderRadius: size / 2,
                    backgroundColor: color,
                    opacity: TRAIL_OPACITY.first - (index * TRAIL_OPACITY.fade) / TRAIL[level].dots,
                    top: CENTER + DOT / 2 + index * TRAIL[level].gap - size / 2,
                    left: CENTER - size / 2,
                  },
                ]}
              />
            );
          })}
        </View>
      )}
      {!fast || heading === null || heading === undefined ? null : (
        <View
          pointerEvents="none"
          style={[styles.trail, { transform: [{ rotate: `${String(hdg ?? 0)}deg` }] }]}
        >
          {STREAKS.map((streak) => (
            <View
              key={streak.side}
              style={[
                styles.dot,
                {
                  width: STREAK_WIDTH,
                  height: streak.length,
                  borderRadius: STREAK_WIDTH / 2,
                  backgroundColor: color,
                  opacity: streak.opacity,
                  top: CENTER + DOT,
                  left: CENTER + streak.side - STREAK_WIDTH / 2,
                },
              ]}
            />
          ))}
        </View>
      )}
      {burst === null || burst === undefined ? null : (
        <MeetBurst key={burst.at} at={burst.at} colors={burst.colors} />
      )}
      {above === undefined ? null : (
        <View style={styles.above} pointerEvents="box-none">
          {above}
        </View>
      )}
      <Animated.View style={[styles.pin, jumping]} pointerEvents="box-none">
        {handlers === undefined ? (
          pin
        ) : (
          <PersonGestures handlers={handlers}>
            <View collapsable={false}>{pin}</View>
          </PersonGestures>
        )}
      </Animated.View>
    </View>
  );
}

/** The marker box size, for tests and for placing things relative to the position. */
export const MAP_AVATAR_BOX = BOX;

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX },
  trail: { ...StyleSheet.absoluteFill },
  dot: { position: 'absolute' },
  // The pin hangs from its top so that its tip lands on the centre; the age label below it is
  // free to grow without moving the tip.
  pin: { position: 'absolute', left: 0, right: 0, top: CENTER - PIN_HEIGHT, alignItems: 'center' },
  // Whatever sits above the pin ends where the pin begins.
  above: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: BOX - CENTER + PIN_HEIGHT + space.xs,
    alignItems: 'center',
  },
});
