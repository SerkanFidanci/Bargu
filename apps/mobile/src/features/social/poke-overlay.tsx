import type { PokeSaying, PokeStyle } from '@bargu/schemas';
import { X } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated, {
  Easing,
  Extrapolation,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { elevation, pokeFx, radius, space, touchTarget, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { pokeWith, type ShownPoke, usePokeShow } from './poke';
import { POKE_EMOJI } from './poke-sheet';

type Feeling = Exclude<PokeStyle, 'where' | 'when' | 'answer' | 'reply'>;
type Question = 'where' | 'when' | 'answer';

/** What flies around the big one, by feeling. */
const PIECES: Record<Feeling, readonly string[]> = {
  kiss: ['💋', '❤️', '💋', '💕'],
  hug: ['💛', '🤗', '💛', '🫶'],
  angry: ['💢', '😠', '💢', '🔥'],
  laugh: ['😂', '🤣', '😆'],
  excited: ['✨', '🎉', '🤩', '⭐'],
};

/** The ready replies offered for each question (docs/ADR/0031). */
const REPLIES: Record<Question, readonly PokeSaying[]> = {
  where: ['onWay', 'soon', 'home', 'busy'],
  when: ['soon', 'later', 'ok', 'busy'],
  answer: ['ok', 'onWay', 'later', 'busy'],
};

/** Takes this poke off the screen, unless another one has taken its place already. */
function clear(key: number): void {
  if (usePokeShow.getState()?.key === key) usePokeShow.setState(null, true);
}

/**
 * A poke for this phone, over whatever screen is open (docs/ADR/0031; the owner: "öpmede
 * dürtülenin ekranı öpülsün, animasyonlu"): a feeling plays for a moment and never takes a touch;
 * a question waits with its ready replies; a reply says itself.
 */
export function PokeOverlay() {
  const shown = usePokeShow();
  if (shown === null) return null;
  return <PokePlay key={shown.key} poke={shown} />;
}

function PokePlay({ poke }: { poke: ShownPoke }) {
  const { t } = useTranslation();
  const words =
    poke.style === 'reply' && poke.say !== undefined
      ? t('notifications.pokes.reply', { name: poke.name, say: t(`map.poke.say.${poke.say}`) })
      : t(`notifications.pokes.${poke.style}`, { name: poke.name });
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(words);
  }, [words]);
  if (poke.style === 'where' || poke.style === 'when' || poke.style === 'answer') {
    return <QuestionCard poke={poke} question={poke.style} words={words} />;
  }
  if (poke.style === 'reply') return <NoteCard poke={poke} words={words} />;
  return <FeelingBurst poke={poke} feeling={poke.style} words={words} />;
}

/** A feeling over the whole screen: the big one in the middle, the small ones around it. */
function FeelingBurst({
  poke,
  feeling,
  words,
}: {
  poke: ShownPoke;
  feeling: Feeling;
  words: string;
}) {
  const level = useEffects();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const progress = useSharedValue(0);
  const still = level === 'off';

  useEffect(() => {
    const done = () => {
      clear(poke.key);
    };
    // Effects off (or battery saving, or the system's "reduce motion"): the words only.
    if (still) {
      toast.info(words);
      done();
      return;
    }
    progress.set(
      withTiming(
        1,
        {
          duration: level === 'reduced' ? pokeFx.reducedMs : pokeFx.durationMs,
          easing: Easing.out(Easing.quad),
        },
        (finished) => {
          if (finished === true) scheduleOnRN(done);
        },
      ),
    );
  }, [level, poke.key, progress, still, words]);

  if (still) return null;
  const count = level === 'reduced' ? Math.ceil(pokeFx.pieces / 2) : pokeFx.pieces;
  const glow = feeling === 'hug' ? colors.accent : feeling === 'angry' ? colors.danger : null;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID={`poke-play-${feeling}`}>
      {glow === null ? null : <EdgeGlow color={glow} progress={progress} />}
      <View style={styles.middle}>
        {Array.from({ length: count }, (_, index) => (
          <Piece
            key={index}
            index={index}
            count={count}
            feeling={feeling}
            progress={progress}
            width={width}
            height={height}
          />
        ))}
        <Middle feeling={feeling} progress={progress} />
      </View>
      <View style={[styles.caption, { top: insets.top + space.lg }]}>
        <View
          style={[
            styles.captionPill,
            { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
          ]}
        >
          <Text variant="bodyStrong">{words}</Text>
        </View>
      </View>
    </View>
  );
}

/** The big one: it lands with a bounce, an angry one shakes. */
function Middle({ feeling, progress }: { feeling: Feeling; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    const scale = interpolate(p, [0, 0.18, 0.3, 0.75, 1], [0.2, 1.25, 1, 1, 0.8]);
    const opacity = interpolate(p, [0, 0.08, 0.78, 1], [0, 1, 1, 0]);
    const shake =
      feeling === 'angry'
        ? Math.sin(p * Math.PI * 2 * pokeFx.shake.times) * pokeFx.shake.px * (1 - p)
        : 0;
    return { opacity, transform: [{ translateX: shake }, { scale }] };
  });
  return (
    <Animated.View style={[styles.piece, style]}>
      <Text allowFontScaling={false} style={styles.big}>
        {POKE_EMOJI[feeling]}
      </Text>
    </Animated.View>
  );
}

/**
 * One small piece. A laugh rises from the bottom of the screen; the others fly out from the middle
 * (a hug's float up, slower and closer). Each by a fixed pattern of its number.
 */
function Piece({
  index,
  count,
  feeling,
  progress,
  width,
  height,
}: {
  index: number;
  count: number;
  feeling: Feeling;
  progress: SharedValue<number>;
  width: number;
  height: number;
}) {
  const pieces = PIECES[feeling];
  const emoji = pieces[index % pieces.length] ?? '';
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    const opacity = interpolate(p, [0, 0.1, 0.7, 1], [0, 1, 1, 0]);
    if (feeling === 'laugh') {
      const x = ((index + 0.5) / count - 0.5) * width * 0.9;
      const from = height / 2 + pokeFx.small;
      const to = from - pokeFx.rise - (index % 4) * pokeFx.small;
      const y = interpolate(p, [0, 1], [from, to]);
      const sway = Math.sin(p * Math.PI * 2 + index) * space.md;
      return { opacity, transform: [{ translateX: x + sway }, { translateY: y }] };
    }
    const angle = (index / count) * Math.PI * 2 + (index % 3) * 0.35;
    const reach = pokeFx.spread * (feeling === 'hug' ? 0.6 : 0.55 + ((index * 7) % 5) / 10);
    const out = interpolate(p, [0, 0.6], [0, 1], Extrapolation.CLAMP);
    const lift = feeling === 'hug' ? -pokeFx.rise * 0.3 * p : 0;
    const scale = interpolate(p, [0, 0.3], [0.4, 1], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [
        { translateX: Math.cos(angle) * reach * out },
        { translateY: Math.sin(angle) * reach * out + lift },
        { scale },
      ],
    };
  });
  return (
    <Animated.View style={[styles.piece, style]}>
      <Text allowFontScaling={false} style={styles.small}>
        {emoji}
      </Text>
    </Animated.View>
  );
}

/** A hug warms the edges of the screen, an angry poke reddens them. */
function EdgeGlow({ color, progress }: { color: string; progress: SharedValue<number> }) {
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(progress.get(), [0, 0.25, 0.7, 1], [0, 1, 1, 0]),
  }));
  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        { boxShadow: `inset 0px 0px ${String(pokeFx.edge)}px ${color}`, opacity: pokeFx.glow },
        style,
      ]}
    />
  );
}

/** "Nerdesin?", "Ne zaman?", "Cevap ver!": the question, and a reply at one tap. */
function QuestionCard({
  poke,
  question,
  words,
}: {
  poke: ShownPoke;
  question: Question;
  words: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const motion = useMotion();
  const [sending, setSending] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      clear(poke.key);
    }, pokeFx.questionHoldMs);
    return () => {
      clearTimeout(timer);
    };
  }, [poke.key]);

  const reply = async (say: PokeSaying) => {
    setSending(true);
    const result = await pokeWith(poke.circleId, poke.userId, 'reply', say);
    setSending(false);
    if (result === 'sent') {
      feedback('success');
      toast.success(t('map.poke.replied', { name: poke.name }));
      clear(poke.key);
    } else {
      toast.error(t(result === 'limited' ? 'map.poke.limited' : 'map.poke.failed'));
    }
  };

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      <Animated.View
        entering={motion.enterDown}
        testID="poke-question"
        style={[
          styles.card,
          {
            top: insets.top + space.sm,
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            boxShadow: elevation.floating,
          },
        ]}
      >
        <View style={styles.cardHead}>
          <Text variant="title2" allowFontScaling={false}>
            {POKE_EMOJI[question]}
          </Text>
          <Text variant="headline" style={styles.cardText}>
            {words}
          </Text>
          <IconButton
            icon={X}
            label={t('common.close')}
            tone="plain"
            onPress={() => {
              clear(poke.key);
            }}
          />
        </View>
        <View style={styles.replies}>
          {REPLIES[question].map((say) => (
            <PressableScale
              key={say}
              testID={`poke-reply-${say}`}
              haptic="select"
              accessibilityRole="button"
              disabled={sending}
              onPress={() => {
                void reply(say);
              }}
              style={[styles.reply, { backgroundColor: colors.primarySoft }]}
            >
              <Text variant="callout">{t(`map.poke.say.${say}`)}</Text>
            </PressableScale>
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

/** A reply to a question this phone asked: a card for a moment. */
function NoteCard({ poke, words }: { poke: ShownPoke; words: string }) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const motion = useMotion();
  useEffect(() => {
    const timer = setTimeout(() => {
      clear(poke.key);
    }, pokeFx.replyHoldMs);
    return () => {
      clearTimeout(timer);
    };
  }, [poke.key]);
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        entering={motion.enterDown}
        testID="poke-reply"
        style={[
          styles.card,
          {
            top: insets.top + space.sm,
            backgroundColor: colors.surfaceRaised,
            borderColor: colors.border,
            boxShadow: elevation.floating,
          },
        ]}
      >
        <View style={styles.cardHead}>
          <Text variant="title2" allowFontScaling={false}>
            {POKE_EMOJI.reply}
          </Text>
          <Text variant="headline" style={styles.cardText}>
            {words}
          </Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  middle: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  piece: { position: 'absolute' },
  big: { fontSize: pokeFx.big, lineHeight: pokeFx.big * 1.2 },
  small: { fontSize: pokeFx.small, lineHeight: pokeFx.small * 1.2 },
  caption: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  captionPill: {
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.pill,
  },
  card: {
    position: 'absolute',
    left: space.lg,
    right: space.lg,
    padding: space.lg,
    gap: space.md,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  cardText: { flex: 1 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  reply: {
    minHeight: touchTarget,
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
