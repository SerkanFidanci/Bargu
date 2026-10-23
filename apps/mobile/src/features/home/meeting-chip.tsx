import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { z } from 'zod';

import { ambient, elevation, radius, shortcutFx, space, touchTarget, useTheme } from '@/theme';
import { type EffectLevel, repeatFinite, timesAt, useEffects } from '@/theme/effects';
import { useMotion } from '@/theme/use-motion';
import { useCelebration } from '@/ui/confetti';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { endClock } from '../circles/event-ui';
import type { MeetingPoint } from '../plan/meeting-points';
import { useDocs } from '../plan/docs';
import { answerCounts, answersOf, headcount } from '../plan/plan-model';
import { useArrivals } from '../plan/use-arrivals';
import { isVaultOpen, vault } from '../storage/vault';
import { countdown, nextMeeting, type TimedPoint } from './shortcuts-model';

/** Meetings this phone already celebrated (`${circleId}:${meetAt}`), the latest few. */
const CELEBRATED_KEY = 'meeting:celebrated:v1';
const CELEBRATED_KEPT = 20;

/**
 * The next meeting at the top of the map (the project owner's request, docs/ADR/0026 §8): its
 * place and time, a countdown in its last hour, and from its time who is there ("2/4 geldi · 1
 * yolda", by the meeting's privacy rules). Runs on the phone's clock, nothing is fetched. A tap
 * opens the meeting's screen.
 */
export function MeetingChip({
  circles,
  points,
  now,
  me,
}: {
  circles: readonly Circle[];
  points: readonly MeetingPoint[];
  now: number;
  me: string | null;
}) {
  const next = nextMeeting(points, now);
  const circle =
    next === null ? undefined : circles.find((candidate) => candidate.id === next.point.circleId);
  if (next === null || circle === undefined || me === null) return null;
  return (
    <Chip
      key={`${circle.id}:${String(next.point.meetAt)}`}
      circle={circle}
      point={next.point}
      more={next.more}
      now={now}
      me={me}
    />
  );
}

function Chip({
  circle,
  point,
  more,
  now,
  me,
}: {
  circle: Circle;
  point: TimedPoint;
  more: number;
  now: number;
  me: string;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const level = useEffects();
  const meeting = { circleId: circle.id, meetAt: point.meetAt, place: point.place };
  const count = headcount(useArrivals(circle, meeting, me, now));
  const { phase, minutes } = countdown(point.meetAt, now);
  const close = phase === 'close';
  const breathing = useBreathing(close, level);
  useCelebrateOnce(`${circle.id}:${String(point.meetAt)}`, count.allThereExactly);

  const where = `${point.place.emoji} ${point.place.name}`;
  // Before its time, a meeting outside an event says how many said they come (ADR 0026 Ek 2).
  const answers = answerCounts(answersOf(useDocs(), circle.id));
  // On one line (the owner, 2026-10-23): how many come; who said "Belki" is on the meeting's screen.
  const answered =
    circle.kind !== 'event' && answers.going > 0
      ? t('meeting.chip.going', { count: answers.going })
      : null;
  const everyone = count.total > 1 && count.there === count.total;
  const lead = (
    phase === 'now'
      ? [
          where,
          everyone
            ? t('meeting.chip.everyone')
            : t('meeting.chip.there', { there: count.there, total: count.total }),
          everyone || count.coming === 0 ? null : t('meeting.chip.coming', { count: count.coming }),
        ]
      : [where, endClock(point.meetAt, now, i18n.language), answered]
  ).filter((part) => part !== null);
  // The minutes left, rolling in as they change (the rest of the text stays still).
  const left =
    phase === 'soon' || phase === 'close' ? t('meeting.chip.minutes', { minutes }) : null;
  const text = [...lead, left].filter((part) => part !== null).join(' · ');
  const tint = close ? colors.onAccent : colors.text;

  return (
    <Animated.View entering={motion.pop} exiting={motion.fadeOut}>
      <Animated.View style={breathing}>
        <PressableScale
          testID="meeting-chip"
          haptic="select"
          accessibilityRole="button"
          accessibilityLabel={t('meeting.chip.label', { title: point.title, text })}
          onPress={() => {
            router.push({ pathname: '/meeting/[circleId]', params: { circleId: circle.id } });
          }}
          style={[
            styles.chip,
            {
              backgroundColor: close ? colors.accent : colors.surfaceRaised,
              boxShadow: elevation.floating,
            },
          ]}
        >
          <Flag color={close ? colors.onAccent : colors.accent} size={18} strokeWidth={2.5} />
          <View style={styles.text}>
            <Text
              variant="subhead"
              numberOfLines={1}
              maxFontSizeMultiplier={1.4}
              style={{ color: tint }}
            >
              {lead.join(' · ')}
              {left === null ? '' : ' ·'}
            </Text>
            {left === null ? null : <Rolling text={left} color={tint} level={level} />}
          </View>
          {more > 0 ? (
            <Text variant="caption" maxFontSizeMultiplier={1.6} style={{ color: tint }}>
              {t('meeting.chip.more', { count: more })}
            </Text>
          ) : null}
        </PressableScale>
      </Animated.View>
    </Animated.View>
  );
}

/** The minutes left: a changed value rolls in from below (once per change, none when "off"). */
function Rolling({ text, color, level }: { text: string; color: string; level: EffectLevel }) {
  const offset = useSharedValue(0);
  const shown = useRef(text);
  useEffect(() => {
    if (shown.current === text) return;
    shown.current = text;
    if (level === 'off') return;
    offset.set(shortcutFx.roll.distance);
    offset.set(
      withTiming(0, { duration: shortcutFx.roll.duration, easing: Easing.out(Easing.cubic) }),
    );
  }, [text, level, offset]);
  const style = useAnimatedStyle(() => ({
    opacity: 1 - offset.get() / shortcutFx.roll.distance,
    transform: [{ translateY: offset.get() }],
  }));
  return (
    <Animated.View style={style}>
      <Text variant="subhead" maxFontSizeMultiplier={1.6} style={{ color }}>
        {text}
      </Text>
    </Animated.View>
  );
}

/**
 * The last stretch before the meeting begins: the chip breathes a few times, then stays still
 * (once when reduced, not at all when "off"); never an endless loop.
 */
function useBreathing(on: boolean, level: EffectLevel) {
  const scale = useSharedValue(1);
  useEffect(() => {
    const breaths = timesAt(level, shortcutFx.chipBreaths);
    if (!on || breaths === 0) return;
    scale.set(
      repeatFinite(
        withTiming(ambient.breathe.scale, {
          duration: ambient.breathe.duration / 2,
          easing: Easing.inOut(Easing.quad),
        }),
        breaths,
        true,
      ),
    );
  }, [on, level, scale]);
  return useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
}

const celebratedSchema = z.array(z.string()).max(CELEBRATED_KEPT);

/**
 * Everyone there, each by an exact location: confetti once for this meeting (the map plays it, and
 * skips it with Reduce Motion), remembered on this phone only.
 */
function useCelebrateOnce(key: string, ready: boolean) {
  useEffect(() => {
    if (!ready || !isVaultOpen()) return;
    const store = vault();
    const parsed = celebratedSchema.safeParse(JSON.parse(store.get(CELEBRATED_KEY) ?? '[]'));
    const done = parsed.success ? parsed.data : [];
    if (done.includes(key)) return;
    store.set(CELEBRATED_KEY, JSON.stringify([...done, key].slice(-CELEBRATED_KEPT)));
    useCelebration.getState().celebrate();
  }, [key, ready]);
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    alignSelf: 'center',
    maxWidth: '100%',
  },
  text: {
    flexShrink: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: space.xs,
  },
});
