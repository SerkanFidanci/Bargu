import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { elevation, pinFx, radius, space, spring, timing, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';
import { GLYPH } from '@/ui/activity-glyph';
import { AvatarMarker, type AvatarMarkerProps, PIN_CIRCLE, PIN_HEIGHT } from '@/ui/avatar-marker';
import { Text } from '@/ui/text';

import { CLUSTER_PX } from './cluster';
import { MAP_AVATAR_BOX } from './map-avatar';
import { MeetBurst } from './meet-burst';
import type { ScreenPoint } from './person-focus';
import { type PersonHandlers, PersonGestures } from './person-gestures';

/** Someone in a group standing together: their avatar as on their own, and what goes with it. */
export interface TogetherPerson {
  id: string;
  marker: Omit<AvatarMarkerProps, 'framed'>;
  handlers?: PersonHandlers | undefined;
  pokedAt?: number | undefined;
  /** Drawn above their avatar (a status bubble). */
  above?: ReactNode;
}

/**
 * One avatar to the next in the shared pin: room between them for the left one's activity badge on
 * its upper right (proje sahibi 2026-10-16: "iç içe girmemeli ama sağ üstlerinde durum şeyleri
 * çıkacak"); the last one's badge sits on the pin's corner, as on a pin of its own.
 */
const FRAME_SLOT = PIN_CIRCLE + GLYPH / 2 + pinFx.together.gap;
/**
 * More than two: room on the pin's right for the count, a clear gap from the last avatar and its
 * badge (proje sahibi 2026-10-16: "3 bir şeyin üzerine binmesin").
 */
const COUNT_ROOM = GLYPH / 2 + space.lg + space.sm;

/** The avatars' part of the pin, edge to edge. */
const avatarsWidth = (count: number) => (count - 1) * FRAME_SLOT + PIN_CIRCLE;
/** Where each avatar's centre sits from the pin's centre of avatars, left to right. */
const slotX = (index: number, count: number) =>
  index * FRAME_SLOT + PIN_CIRCLE / 2 - avatarsWidth(count) / 2;

/** One avatar sliding from where its person was into its place in the pin; jumps when poked. */
function Slot({
  person,
  index,
  from,
  to,
  merge,
  tappable,
}: {
  person: TogetherPerson;
  index: number;
  from: { x: number; y: number };
  to: number;
  merge: SharedValue<number>;
  /** Their own tap and hold; off when a tap on the pin lists everyone instead. */
  tappable: boolean;
}) {
  const lift = useSharedValue(0);
  useEffect(() => {
    if (person.pokedAt === undefined) return;
    lift.set(withSequence(withTiming(-space.xl, timing.fast), withSpring(0, spring.bouncy)));
  }, [person.pokedAt, lift]);
  const sliding = useAnimatedStyle(() => ({
    transform: [
      { translateX: (from.x - to) * (1 - merge.get()) },
      { translateY: from.y * (1 - merge.get()) + lift.get() },
    ],
  }));
  const avatar = <AvatarMarker {...person.marker} framed />;
  return (
    <Animated.View
      style={[styles.slot, { left: index * FRAME_SLOT }, sliding]}
      pointerEvents="box-none"
    >
      {person.above === undefined ? null : (
        <View style={styles.above} pointerEvents="box-none">
          {person.above}
        </View>
      )}
      {!tappable || person.handlers === undefined ? (
        avatar
      ) : (
        <PersonGestures handlers={person.handlers}>
          <View collapsable={false}>{avatar}</View>
        </PersonGestures>
      )}
    </Animated.View>
  );
}

/**
 * People standing together (proje sahibi 2026-10-16: "2'si tek çerçevede toplansın, 2'den fazla
 * varsa sağ üstte yazsın, tıklayınca oradaki kişiler bir pencerede gözüksün"), as one shared pin
 * (the owner, 2026-10-18): the avatars slide from where each was into one ring, with one tail down
 * to one dot on where they are. Two people: each avatar is still theirs to tap or hold. More: the
 * pin says how many in its upper right corner, and a tap lists everyone there.
 */
export function ClusterBubble({
  people,
  more,
  offsets,
  everyone,
  burst,
  onList,
}: {
  /** Who shows, in order (cluster.ts capsuleOf). */
  people: readonly TogetherPerson[];
  /** How many more there are than shown. */
  more: number;
  /** Where each one shown was on screen relative to the centre (px). */
  offsets: readonly { x: number; y: number }[];
  /** Everyone's names, for the pin's label. */
  everyone: readonly string[];
  /** A meeting to celebrate here (the user is one of them). */
  burst?: { at: number; colors: readonly [string, string] } | null | undefined;
  /** More than two: a tap on the pin, to list everyone here. */
  onList: (point: ScreenPoint) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useEffects() === 'off';
  const merge = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    merge.set(withSpring(1, spring.gentle));
  }, [merge]);

  const count = people.length;
  const listed = more > 0;
  const avatars = avatarsWidth(count);
  const frameWidth = avatars + (listed ? COUNT_ROOM : 0);
  // The avatars stay centred on the position; the count's room reaches out to the right.
  const width = (avatars / 2 + (listed ? COUNT_ROOM + space.sm : 0) + CLUSTER_PX) * 2;
  const center = { x: width / 2, y: MAP_AVATAR_BOX / 2 };
  const fromOf = (index: number) => offsets[index] ?? { x: 0, y: 0 };
  // Grey only when every location here is old.
  const ring = people.every((person) => person.marker.staleMinutes !== undefined)
    ? colors.textMuted
    : colors.primary;
  const appear = useAnimatedStyle(() => ({ opacity: merge.get() }));

  const row = (
    <>
      <Animated.View
        style={[
          styles.frame,
          {
            backgroundColor: colors.surfaceRaised,
            borderColor: ring,
            boxShadow: elevation.raised,
          },
          appear,
        ]}
        pointerEvents="none"
      />
      {people.map((person, index) => (
        <Slot
          key={person.id}
          person={person}
          index={index}
          from={fromOf(index)}
          to={slotX(index, count)}
          merge={merge}
          tappable={!listed}
        />
      ))}
      {listed ? (
        <Animated.View
          style={[
            styles.count,
            { backgroundColor: colors.primary, borderColor: colors.surfaceRaised },
            appear,
          ]}
          pointerEvents="none"
        >
          <Text variant="caption" allowFontScaling={false} style={{ color: colors.onPrimary }}>
            {String(everyone.length)}
          </Text>
        </Animated.View>
      ) : null}
    </>
  );
  const placed = { left: center.x - avatars / 2, top: center.y - PIN_HEIGHT, width: frameWidth };

  return (
    <View style={[styles.box, { width }]} pointerEvents="box-none">
      <Animated.View
        pointerEvents="none"
        style={[
          styles.tail,
          {
            left: center.x - pinFx.tailWidth / 2,
            top: center.y - pinFx.tail - pinFx.ring / 2,
            borderTopColor: ring,
          },
          appear,
        ]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.dot,
          {
            left: center.x - pinFx.dot / 2,
            top: center.y - pinFx.dot / 2,
            backgroundColor: ring,
            borderColor: colors.surfaceRaised,
          },
        ]}
      />
      {burst === null || burst === undefined ? null : (
        <MeetBurst key={burst.at} at={burst.at} colors={burst.colors} />
      )}
      {listed ? (
        <Pressable
          onPress={(event) => {
            onList({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
          }}
          accessibilityRole="button"
          accessibilityLabel={t('map.cluster', {
            count: everyone.length,
            names: everyone.join(', '),
          })}
          style={[styles.row, placed]}
        >
          {row}
        </Pressable>
      ) : (
        <View style={[styles.row, placed]} pointerEvents="box-none">
          {row}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: MAP_AVATAR_BOX },
  row: { position: 'absolute', height: PIN_CIRCLE },
  frame: { ...StyleSheet.absoluteFill, borderRadius: radius.pill, borderWidth: pinFx.ring },
  slot: { position: 'absolute', top: 0, width: PIN_CIRCLE, alignItems: 'center' },
  // Whatever sits above an avatar ends where it begins.
  above: { position: 'absolute', bottom: PIN_HEIGHT + space.xs, alignItems: 'center' },
  // A downward triangle from the shared ring to the dot.
  tail: {
    position: 'absolute',
    width: 0,
    height: 0,
    borderLeftWidth: pinFx.tailWidth / 2,
    borderRightWidth: pinFx.tailWidth / 2,
    borderTopWidth: pinFx.tail + pinFx.ring / 2,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  dot: {
    position: 'absolute',
    width: pinFx.dot,
    height: pinFx.dot,
    borderRadius: radius.pill,
    borderWidth: pinFx.ring / 2,
  },
  // How many stand here, on the pin's upper right corner.
  count: {
    position: 'absolute',
    top: -space.sm,
    right: -space.sm,
    minWidth: space.xl,
    height: space.xl,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
