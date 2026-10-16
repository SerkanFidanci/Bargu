import { Blur, Canvas, ColorMatrix, Group, Oval, Paint } from '@shopify/react-native-skia';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
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
import { Text } from '@/ui/text';

import { CLUSTER_PX } from './cluster';
import { MAP_AVATAR_BOX } from './map-avatar';
import { MeetBurst } from './meet-burst';
import { type PersonHandlers, PersonGestures } from './person-gestures';

/** One sticker to the next, side by side. */
const SLOT = STICKER + stickerFx.together.gap;
const ISLAND = stickerFx.island;
/** "Goo": blur the islands, then cut the blurred alpha sharply so touching shapes become one. */
const GOO_BLUR = space.md;
const GOO_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 24, -9];

/** Someone in a group standing together: their sticker as on their own, and what goes with it. */
export interface TogetherPerson {
  id: string;
  marker: Omit<AvatarMarkerProps, 'island'>;
  handlers?: PersonHandlers | undefined;
  pokedAt?: number | undefined;
  /** Drawn above their sticker (a status bubble). */
  above?: ReactNode;
}

/** Where each slot sits from the centre, left to right. */
const slotX = (index: number, count: number) => (index - (count - 1) / 2) * SLOT;

/** One island flowing from where its person was to under their sticker, growing as it goes. */
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

/** One sticker sliding from where its person was into its place in the row; jumps when poked. */
function Slot({
  person,
  from,
  to,
  merge,
  center,
}: {
  person: TogetherPerson;
  from: { x: number; y: number };
  to: number;
  merge: SharedValue<number>;
  center: { x: number; y: number };
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
  const sticker = <AvatarMarker {...person.marker} island={false} />;
  return (
    <Animated.View
      style={[styles.slot, { left: center.x + to - SLOT / 2, top: center.y - PIN_HEIGHT }, sliding]}
      pointerEvents="box-none"
    >
      {person.above === undefined ? null : (
        <View style={styles.above} pointerEvents="box-none">
          {person.above}
        </View>
      )}
      {person.handlers === undefined ? (
        sticker
      ) : (
        <PersonGestures handlers={person.handlers}>
          <View collapsable={false}>{sticker}</View>
        </PersonGestures>
      )}
    </Animated.View>
  );
}

/**
 * People standing together (proje sahibi 2026-10-16: avatars sat on top of one another, the
 * user's own included): their islands flow into one like liquid (Skia "goo" on the UI thread,
 * BARGU_PLAN §4.3) and their stickers line up side by side above it, each still a person to tap
 * or hold. Past a few people the rest are a "+N" sticker that zooms in.
 */
export function ClusterBubble({
  people,
  more,
  offsets,
  everyone,
  burst,
  onMore,
}: {
  /** Who shows, in order (cluster.ts capsuleOf). */
  people: readonly TogetherPerson[];
  /** How many more there are than shown. */
  more: number;
  /** Where each one shown was on screen relative to the centre (px). */
  offsets: readonly { x: number; y: number }[];
  /** Everyone's names, for the "+N" sticker's label. */
  everyone: readonly string[];
  /** A meeting to celebrate here (the user is one of them). */
  burst?: { at: number; colors: readonly [string, string] } | null | undefined;
  onMore: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const merge = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    merge.set(withSpring(1, spring.gentle));
  }, [merge]);

  const count = people.length + (more > 0 ? 1 : 0);
  const width = count * SLOT + CLUSTER_PX * 2;
  const center = { x: width / 2, y: MAP_AVATAR_BOX / 2 };
  const fromOf = (index: number) => {
    const offset = offsets[index] ?? { x: 0, y: 0 };
    return { x: offset.x, y: offset.y };
  };
  const tintOf = (person: TogetherPerson) =>
    person.marker.staleMinutes !== undefined
      ? colors.textMuted
      : (avatarPalette[person.marker.avatar?.color ?? 0] ?? colors.primary);
  const extra = useAnimatedStyle(() => ({ opacity: merge.get() }));

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
            {more > 0 ? (
              <Island
                from={{ x: slotX(count - 1, count), y: 0 }}
                to={slotX(count - 1, count)}
                merge={merge}
                color={colors.textMuted}
                center={center}
              />
            ) : null}
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
      {people.map((person, index) => (
        <Slot
          key={person.id}
          person={person}
          from={fromOf(index)}
          to={slotX(index, count)}
          merge={merge}
          center={center}
        />
      ))}
      {more > 0 ? (
        <Animated.View
          style={[
            styles.slot,
            { left: center.x + slotX(count - 1, count) - SLOT / 2, top: center.y - PIN_HEIGHT },
            extra,
          ]}
        >
          <Pressable
            onPress={onMore}
            accessibilityRole="button"
            accessibilityLabel={t('map.cluster', {
              count: everyone.length,
              names: everyone.join(', '),
            })}
            style={[
              styles.more,
              { backgroundColor: stickerPaper, boxShadow: elevation.raised },
              { transform: [{ rotate: `${String(stickerTilt('more'))}deg` }] },
            ]}
          >
            <Text variant="headline" allowFontScaling={false} style={{ color: colors.primary }}>
              {t('map.more', { count: more })}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: MAP_AVATAR_BOX },
  slot: { position: 'absolute', width: SLOT, alignItems: 'center' },
  // Whatever sits above a sticker ends where it begins.
  above: { position: 'absolute', bottom: PIN_HEIGHT + space.xs, alignItems: 'center' },
  more: {
    width: STICKER,
    height: STICKER,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
