import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { Flag } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { z } from 'zod';

import { ambient, elevation, radius, space, touchTarget, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { useCelebration } from '@/ui/confetti';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { endClock } from '../circles/event-ui';
import type { MeetingPoint } from '../plan/meeting-points';
import { headcount } from '../plan/plan-model';
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
  const meeting = { circleId: circle.id, meetAt: point.meetAt, place: point.place };
  const count = headcount(useArrivals(circle, meeting, me, now));
  const { phase, minutes } = countdown(point.meetAt, now);
  const close = phase === 'close';
  const breathing = useBreathing(close);
  useCelebrateOnce(`${circle.id}:${String(point.meetAt)}`, count.allThereExactly);

  const where = `${point.place.emoji} ${point.place.name}`;
  const everyone = count.total > 1 && count.there === count.total;
  const parts =
    phase === 'now'
      ? [
          where,
          everyone
            ? t('meeting.chip.everyone')
            : t('meeting.chip.there', { there: count.there, total: count.total }),
          everyone || count.coming === 0 ? null : t('meeting.chip.coming', { count: count.coming }),
        ]
      : [
          where,
          endClock(point.meetAt, now, i18n.language),
          phase === 'later' ? null : t('meeting.chip.minutes', { minutes }),
        ];
  const text = parts.filter((part) => part !== null).join(' · ');
  const tint = close ? colors.onAccent : colors.text;

  return (
    <Animated.View entering={motion.pop} exiting={motion.fadeOut} style={breathing}>
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
        <Text
          variant="subhead"
          numberOfLines={2}
          maxFontSizeMultiplier={1.6}
          style={[styles.text, { color: tint }]}
        >
          {text}
        </Text>
        {more > 0 ? (
          <Text variant="caption" maxFontSizeMultiplier={1.6} style={{ color: tint }}>
            {t('meeting.chip.more', { count: more })}
          </Text>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

/** The last stretch before the meeting: the chip breathes gently; it stays still with Reduce Motion. */
function useBreathing(on: boolean) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  useEffect(() => {
    if (!on || reduced) {
      cancelAnimation(scale);
      scale.set(1);
      return;
    }
    scale.set(
      withRepeat(
        withTiming(ambient.breathe.scale, {
          duration: ambient.breathe.duration / 2,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      ),
    );
  }, [on, reduced, scale]);
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
  text: { flexShrink: 1 },
});
