import { ChevronRight, Users } from 'lucide-react-native';
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

import { avatarSize, elevation, pinFx, radius, space, spring, timing, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';
import { AvatarMarker, type AvatarMarkerProps, PIN_CIRCLE, PIN_HEIGHT } from '@/ui/avatar-marker';
import { Text } from '@/ui/text';

import { MAP_AVATAR_BOX } from './map-avatar';
import { MeetBurst } from './meet-burst';
import type { ScreenPoint } from './person-focus';
import { type PersonHandlers, PersonGestures } from './person-gestures';

/** Someone in a group standing together: their avatar as on their own, and what goes with it. */
export interface TogetherPerson {
  id: string;
  marker: Omit<AvatarMarkerProps, 'group'>;
  handlers?: PersonHandlers | undefined;
  pokedAt?: number | undefined;
  /** Drawn above their avatar (a status bubble). */
  above?: ReactNode;
}

/** The others beside the first: this wide, each partly behind the one before. */
const BESIDE = PIN_CIRCLE * pinFx.together.beside;
const COVER = BESIDE * pinFx.together.cover;
/** "+3", as small as a small avatar. */
const COUNT = avatarSize.sm;
/** From the position (the tip of the first one's tail) up to the centre of the faces. */
const RISE = PIN_HEIGHT - PIN_CIRCLE / 2;
/** Each one's centre from the first one's, left to right. */
const slotX = (index: number) =>
  index === 0 ? 0 : PIN_CIRCLE / 2 - COVER + BESIDE / 2 + (index - 1) * (BESIDE - COVER);
/** The count's centre, after `shown` faces. */
const countX = (shown: number) =>
  slotX(shown - 1) + (shown === 1 ? PIN_CIRCLE : BESIDE) / 2 - COVER + COUNT / 2;
/**
 * The box is centred on the position (the map anchors it there): room on the right for the
 * group's pill, and as much on the left.
 */
const HALF = PIN_CIRCLE / 2 + pinFx.together.pillMax + space.lg;
const CENTER = { x: HALF, y: MAP_AVATAR_BOX / 2 };

/**
 * One face in the group pin, sliding from where its person was into its place; jumps when poked.
 * The first is their pin as on its own; the others shrink as they join.
 */
function Slot({
  person,
  index,
  from,
  merge,
}: {
  person: TogetherPerson;
  index: number;
  from: { x: number; y: number };
  merge: SharedValue<number>;
}) {
  const lead = index === 0;
  const to = slotX(index);
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
  const shrinking = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - (1 - pinFx.together.beside) * merge.get() }],
  }));
  const marker = <AvatarMarker {...person.marker} group={lead ? 'lead' : 'beside'} />;
  const avatar =
    person.handlers === undefined ? (
      marker
    ) : (
      <PersonGestures handlers={person.handlers}>
        <View collapsable={false}>{marker}</View>
      </PersonGestures>
    );
  return (
    <Animated.View
      style={[
        styles.slot,
        { left: CENTER.x + to - PIN_CIRCLE / 2, top: CENTER.y - PIN_HEIGHT },
        sliding,
      ]}
      pointerEvents="box-none"
    >
      {person.above === undefined ? null : (
        <View style={styles.above} pointerEvents="box-none">
          {person.above}
        </View>
      )}
      {lead ? avatar : <Animated.View style={shrinking}>{avatar}</Animated.View>}
    </Animated.View>
  );
}

/**
 * People standing together, as one group pin (the owner's picture, 2026-10-29: "1 den fazla kişi
 * gruplandığında … Çerçeveler falan kaybolmasın"): the first one's pin as on its own, its tail
 * down to the position; the others smaller beside it, each with its own ring and look, then "+3"
 * for the rest; under them a pill with how many and, when every location here is old, how old.
 * The faces slide from where each was into their places. Each face is still theirs to tap or
 * hold; the pill and the count list everyone here.
 */
export function ClusterBubble({
  people,
  more,
  offsets,
  everyone,
  age,
  burst,
  onList,
}: {
  /** Who shows, in order, the first one leading (cluster.ts capsuleOf). */
  people: readonly TogetherPerson[];
  /** How many more there are than shown. */
  more: number;
  /** Where each one shown was on screen relative to the centre (px). */
  offsets: readonly { x: number; y: number }[];
  /** Everyone's names, for the pill's label. */
  everyone: readonly string[];
  /** Minutes since the newest location here, when every one is old. */
  age?: number | undefined;
  /** A meeting to celebrate here (the user is one of them). */
  burst?: { at: number; colors: readonly [string, string] } | null | undefined;
  /** A tap on the pill or the count, to list everyone here. */
  onList: (point: ScreenPoint) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useEffects() === 'off';
  const merge = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    merge.set(withSpring(1, spring.gentle));
  }, [merge]);

  const appear = useAnimatedStyle(() => ({ opacity: merge.get() }));
  const fromOf = (index: number) => offsets[index] ?? { x: 0, y: 0 };
  const ageText =
    age === undefined
      ? null
      : age >= 60
        ? t('ui.marker.ageHours', { hours: Math.floor(age / 60) })
        : t('ui.marker.age', { minutes: age });
  const list = (event: { nativeEvent: { pageX: number; pageY: number } }) => {
    onList({ x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
  };
  const [lead, ...beside] = people;

  return (
    <View style={styles.box} pointerEvents="box-none">
      {burst === null || burst === undefined ? null : (
        <MeetBurst key={burst.at} at={burst.at} colors={burst.colors} />
      )}
      {more > 0 ? (
        <Animated.View
          style={[
            styles.count,
            {
              left: CENTER.x + countX(people.length) - COUNT / 2,
              top: CENTER.y - RISE - COUNT / 2,
            },
            appear,
          ]}
        >
          <Pressable
            testID="together-more"
            onPress={list}
            accessible={false}
            importantForAccessibility="no-hide-descendants"
            hitSlop={space.sm}
            style={[
              styles.countFace,
              {
                backgroundColor: colors.primary,
                borderColor: colors.surfaceRaised,
                boxShadow: elevation.raised,
              },
            ]}
          >
            <Text variant="caption" allowFontScaling={false} style={{ color: colors.onPrimary }}>
              {t('map.together.more', { count: more })}
            </Text>
          </Pressable>
        </Animated.View>
      ) : null}
      {/* The first one in front, each one before the next. */}
      {beside
        .map((person, index) => (
          <Slot
            key={person.id}
            person={person}
            index={index + 1}
            from={fromOf(index + 1)}
            merge={merge}
          />
        ))
        .reverse()}
      <Animated.View
        style={[
          styles.pill,
          { left: CENTER.x + PIN_CIRCLE / 2, top: CENTER.y - RISE + BESIDE / 2 + space.xs },
          appear,
        ]}
      >
        <Pressable
          testID="together-pill"
          onPress={list}
          accessibilityRole="button"
          accessibilityLabel={t('map.cluster', {
            count: everyone.length,
            names: everyone.join(', '),
          })}
          hitSlop={space.sm}
          style={[
            styles.pillFace,
            { backgroundColor: colors.primary, boxShadow: elevation.raised },
          ]}
        >
          <Users color={colors.onPrimary} size={space.md} strokeWidth={2.25} />
          <Text
            variant="caption"
            allowFontScaling={false}
            numberOfLines={1}
            style={[styles.pillText, { color: colors.onPrimary }]}
          >
            {ageText === null
              ? t('map.together.pill', { count: everyone.length })
              : t('map.together.pillAge', { count: everyone.length, age: ageText })}
          </Text>
          <ChevronRight color={colors.onPrimary} size={space.md} strokeWidth={2.25} />
        </Pressable>
      </Animated.View>
      {lead === undefined ? null : (
        <Slot key={lead.id} person={lead} index={0} from={fromOf(0)} merge={merge} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: HALF * 2, height: MAP_AVATAR_BOX },
  slot: { position: 'absolute', width: PIN_CIRCLE, alignItems: 'center' },
  // Whatever sits above a face ends where it begins.
  above: { position: 'absolute', bottom: '100%', alignItems: 'center' },
  count: { position: 'absolute', width: COUNT, height: COUNT },
  countFace: {
    width: COUNT,
    height: COUNT,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: { position: 'absolute', maxWidth: pinFx.together.pillMax },
  pillFace: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
  },
  pillText: { flexShrink: 1 },
});
