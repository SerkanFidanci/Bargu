import {
  Blur,
  Canvas,
  ColorMatrix,
  Group,
  LinearGradient,
  Oval,
  Paint,
  RoundedRect,
  vec,
} from '@shopify/react-native-skia';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  avatarPalette,
  elevation,
  radius,
  space,
  spring,
  stickerFx,
  stickerPaper,
  timing,
  useTheme,
} from '@/theme';
import { AvatarMarker, type AvatarMarkerProps, PIN_HEIGHT, STICKER } from '@/ui/avatar-marker';
import { stickerTilt } from '@/ui/sticker';
import { GLYPH } from '@/ui/activity-glyph';
import { Text } from '@/ui/text';
import { useEffects } from '@/theme/effects';

import { CLUSTER_PX } from './cluster';
import { MAP_AVATAR_BOX } from './map-avatar';
import { MeetBurst } from './meet-burst';
import type { ScreenPoint } from './person-focus';
import { type PersonHandlers, PersonGestures } from './person-gestures';

const ISLAND = stickerFx.island;
/** The frame's ring in the people's colours (px). */
const RING = space.xxs + 1;
/** "Goo": blur the islands, then cut the blurred alpha sharply so touching shapes become one. */
const GOO_BLUR = space.md;
const GOO_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 24, -9];

/** Someone in a group standing together: their avatar as on their own, and what goes with it. */
export interface TogetherPerson {
  id: string;
  marker: Omit<AvatarMarkerProps, 'island' | 'framed'>;
  handlers?: PersonHandlers | undefined;
  pokedAt?: number | undefined;
  /** Drawn above their avatar (a status bubble). */
  above?: ReactNode;
}

/**
 * One avatar to the next in the frame: room between them for the left one's status badge on its
 * upper right (proje sahibi 2026-10-16: "iç içe girmemeli ama sağ üstlerinde durum şeyleri
 * çıkacak"); the last one's badge sits on the frame's corner, as on a sticker of its own.
 */
const FRAME_SLOT = STICKER + GLYPH / 2 + space.xs;
/**
 * More than two: room on the frame's right for the count, a clear gap from the last avatar and its
 * badge (proje sahibi 2026-10-16: "3 bir şeyin üzerine binmesin").
 */
const COUNT_ROOM = GLYPH / 2 + space.lg + space.sm;

/** The avatars' part of the frame, edge to edge. */
const avatarsWidth = (count: number) => (count - 1) * FRAME_SLOT + STICKER;
/** Where each avatar's centre sits from the frame's centre of avatars, left to right. */
const slotX = (index: number, count: number) =>
  index * FRAME_SLOT + STICKER / 2 - avatarsWidth(count) / 2;

/** One island flowing from where its person was to under their place, growing as it goes. */
function Island({
  from,
  to,
  merge,
  color,
  center,
}: {
  from: { x: number; y: number };
  to: number;
  merge: SharedValue<number>;
  color: string;
  center: { x: number; y: number };
}) {
  const width = useDerivedValue(
    () => ISLAND.width * (1 + (stickerFx.together.islandGrow - 1) * merge.get()),
  );
  const height = useDerivedValue(
    () => ISLAND.height * (1 + (stickerFx.together.islandTall - 1) * merge.get()),
  );
  const x = useDerivedValue(
    () => center.x + from.x + (to - from.x) * merge.get() - width.get() / 2,
  );
  const y = useDerivedValue(() => center.y + from.y * (1 - merge.get()) - height.get() / 2);
  return <Oval x={x} y={y} width={width} height={height} color={color} />;
}

/** One avatar sliding from where its person was into its place in the frame; jumps when poked. */
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
  /** Their own tap and hold; off when a tap on the frame lists everyone instead. */
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
  const avatar = <AvatarMarker {...person.marker} island={false} framed />;
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
 * varsa sağ üstte yazsın, tıklayınca oradaki kişiler bir pencerede gözüksün"): two avatars flow
 * into one shared sticker frame, its ring running from one person's colour to the other's, above
 * one island where their islands met like liquid (Skia "goo" on the UI thread, BARGU_PLAN §4.3).
 * Two people: each avatar is still theirs to tap or hold. More: the frame says how many in its
 * upper right corner, and a tap lists everyone there.
 */
export function ClusterBubble({
  groupKey,
  people,
  more,
  offsets,
  everyone,
  burst,
  onList,
}: {
  /** The same while the same people stand together (its tilt). */
  groupKey: string;
  /** Who shows, in order (cluster.ts capsuleOf). */
  people: readonly TogetherPerson[];
  /** How many more there are than shown. */
  more: number;
  /** Where each one shown was on screen relative to the centre (px). */
  offsets: readonly { x: number; y: number }[];
  /** Everyone's names, for the frame's label. */
  everyone: readonly string[];
  /** A meeting to celebrate here (the user is one of them). */
  burst?: { at: number; colors: readonly [string, string] } | null | undefined;
  /** More than two: a tap on the frame, to list everyone here. */
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
  const tintOf = (person: TogetherPerson) =>
    person.marker.staleMinutes !== undefined
      ? colors.textMuted
      : (avatarPalette[person.marker.avatar?.color ?? 0] ?? colors.primary);
  const tints = people.map(tintOf);
  const ring = tints.length > 1 ? tints : [...tints, ...tints];
  const appear = useAnimatedStyle(() => ({ opacity: merge.get() }));

  const row = (
    <>
      <Animated.View
        style={[
          styles.frame,
          { backgroundColor: stickerPaper, boxShadow: elevation.raised },
          appear,
        ]}
        pointerEvents="none"
      >
        <Canvas style={StyleSheet.absoluteFill}>
          <RoundedRect
            x={RING / 2}
            y={RING / 2}
            width={frameWidth - RING}
            height={STICKER - RING}
            r={(STICKER - RING) / 2}
            style="stroke"
            strokeWidth={RING}
          >
            <LinearGradient start={vec(0, 0)} end={vec(frameWidth, 0)} colors={ring} />
          </RoundedRect>
        </Canvas>
      </Animated.View>
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
            { backgroundColor: colors.primary, borderColor: stickerPaper },
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
  const placed = {
    left: center.x - avatars / 2,
    top: center.y - PIN_HEIGHT,
    width: frameWidth,
    transform: [{ rotate: `${String(stickerTilt(groupKey) / 2)}deg` }],
  };

  return (
    <View style={[styles.box, { width }]} pointerEvents="box-none">
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group opacity={ISLAND.opacity}>
          <Group
            layer={
              <Paint>
                <Blur blur={GOO_BLUR} />
                <ColorMatrix matrix={GOO_MATRIX} />
              </Paint>
            }
          >
            {people.map((person, index) => (
              <Island
                key={person.id}
                from={fromOf(index)}
                to={slotX(index, count)}
                merge={merge}
                color={tintOf(person)}
                center={center}
              />
            ))}
          </Group>
        </Group>
        <Oval
          x={center.x - ISLAND.core / 2}
          y={center.y - ISLAND.core / 4}
          width={ISLAND.core}
          height={ISLAND.core / 2}
          color={colors.primary}
        />
      </Canvas>
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
  row: { position: 'absolute', height: STICKER },
  frame: { ...StyleSheet.absoluteFill, borderRadius: radius.pill, overflow: 'hidden' },
  slot: { position: 'absolute', top: 0, width: STICKER, alignItems: 'center' },
  // Whatever sits above an avatar ends where it begins.
  above: { position: 'absolute', bottom: PIN_HEIGHT + space.xs, alignItems: 'center' },
  // How many stand here, on the frame's upper right corner.
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
