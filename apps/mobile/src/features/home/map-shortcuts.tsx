import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { CircleCheck, Flag, Ghost, LocateFixed, type LucideIcon } from 'lucide-react-native';
import { type ComponentProps, type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import {
  ambient,
  duration,
  elevation,
  radius,
  shortcutFx,
  space,
  spring,
  touchTarget,
  useTheme,
} from '@/theme';
import { type EffectLevel, repeatFinite, timesAt, useEffects } from '@/theme/effects';
import { useMotion } from '@/theme/use-motion';
import { PressableScale } from '@/ui/pressable-scale';
import type { SheetRef } from '@/ui/sheet';
import { toast } from '@/ui/toast';

import { useMyFix } from '../location/engine';
import { sayArrived } from '../location/location-session';
import { useSharing } from '../location/sharing';
import type { Place } from '../places/place-model';
import { useArrived } from '../plan/meeting';
import { GhostSheet } from './ghost-sheet';
import { hereDue } from './shortcuts-model';
import { StoreButton } from './store-button';

export interface MapShortcutsProps {
  circles: readonly Circle[];
  /** The map looks away from this phone: "back to me" is offered. */
  away: boolean;
  onRecenter: () => void;
  /** The meeting on the chip: "start a meeting" makes way for it, "Geldim" comes near it. */
  meeting: { circle: Circle; meetAt: number; place: Place } | null;
  me: string | null;
  now: number;
  /** Where the column ends, above the dock. */
  bottom: number;
  /**
   * This phone's location is really going to someone now (sharingNow, the same truth as "who sees
   * me"): the ghost button wears a navy dot (a safety sign, the owner's choice).
   */
  shared: boolean;
}

/** The shortcuts sprang in once this app run: coming back (a card closed) is a short fade. */
let sprang = false;

/**
 * Round shortcuts at the right edge of the map, above the dock (the project owner's request,
 * docs/ADR/0026 §8), three at most: back to me (once the map moved away), ghost mode, and start a
 * meeting, which gives way to the meeting's chip at the top while one is on; "Geldim" shows only
 * near its time or place. On top of them the store's button (docs/ADR/0025 Ek 2). Their effects
 * are short and one-off, scaled by sade mod; nothing moves on its own once they are done.
 */
export function MapShortcuts({
  circles,
  away,
  onRecenter,
  meeting,
  me,
  now,
  bottom,
  shared,
}: MapShortcutsProps) {
  const { t } = useTranslation();
  const motion = useMotion();
  const level = useEffects();
  const [first] = useState(() => !sprang);
  useEffect(() => {
    sprang = true;
  }, []);
  const said = useArrived((state) =>
    meeting === null || me === null
      ? false
      : state[`${meeting.circle.id}:${me}`]?.meetAt === meeting.meetAt,
  );
  // A yes or no from the position, which comes every second with the map open: the shortcuts are
  // drawn again only when the answer changes.
  const here = useMyFix(
    (state) =>
      meeting !== null &&
      hereDue({
        meetAt: meeting.meetAt,
        place: meeting.place,
        fix: state.fix,
        now,
        said,
        paused: meeting.circle.paused === true,
      }),
  );
  // The first time: a springy entrance one after another; later a calm fade; none when "off".
  const entering = (index: number) =>
    level === 'off'
      ? FadeIn.duration(duration.instant)
      : first && level === 'full'
        ? motion.springAt(index)
        : FadeIn.duration(duration.fast);

  return (
    <View style={[styles.column, { bottom }]} pointerEvents="box-none" testID="map-shortcuts">
      <Animated.View entering={entering(0)}>
        <StoreButton level={level} />
      </Animated.View>
      {away ? (
        <Animated.View entering={entering(0)} exiting={motion.fadeOut}>
          <RecenterButton level={level} label={t('map.shortcuts.recenter')} onPress={onRecenter} />
        </Animated.View>
      ) : null}
      <Animated.View entering={entering(1)}>
        <GhostButton circles={circles} now={now} level={level} shared={shared} />
      </Animated.View>
      {meeting === null ? (
        <Animated.View entering={entering(2)}>
          <RoundButton
            testID="shortcut-meet"
            icon={Flag}
            label={t('map.shortcuts.meet')}
            onPress={() => {
              router.push('/meeting/new');
            }}
          />
        </Animated.View>
      ) : here ? (
        <Animated.View entering={entering(2)} exiting={motion.fadeOut}>
          <HereButton
            circle={meeting.circle}
            meetAt={meeting.meetAt}
            place={meeting.place}
            level={level}
          />
        </Animated.View>
      ) : null}
    </View>
  );
}

/** "Back to me": one radar ring spreads from the button and the icon turns once, on a tap. */
function RecenterButton({
  level,
  label,
  onPress,
}: {
  level: EffectLevel;
  label: string;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const ring = useSharedValue(1);
  const turn = useSharedValue(0);
  const turned = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(turn.get())}deg` }] }));
  return (
    <RoundButton
      testID="shortcut-recenter"
      icon={LocateFixed}
      label={label}
      iconStyle={turned}
      behind={<Ring progress={ring} color={colors.primary} fx={shortcutFx.radar} />}
      onPress={() => {
        if (level !== 'off') {
          ring.set(0);
          ring.set(
            withTiming(1, { duration: shortcutFx.radar.duration, easing: Easing.out(Easing.quad) }),
          );
          turn.set(0);
          turn.set(
            withTiming(360, {
              duration: shortcutFx.radar.duration,
              easing: Easing.out(Easing.cubic),
            }),
          );
        }
        onPress();
      }}
    />
  );
}

/**
 * Ghost mode from the map: a tap offers the three choices of Me, "Kapalı / Dondur / Gizle" (the PM
 * report T5, 2026-10-29; GhostSheet). Only the icon on the map (the owner, 2026-10-29: "Hayalet
 * yazmasın sadece iconu gözüksün"). Turned on, the ghost floats a few times, then rests; off, a
 * little "pof". Its state shows in colour, in the button's state and in what a screen reader says.
 */
function GhostButton({
  circles,
  now,
  level,
  shared,
}: {
  circles: readonly Circle[];
  now: number;
  level: EffectLevel;
  shared: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const mode = useSharing((state) => state.ghost);
  const on = mode !== 'off';
  const sheet = useRef<SheetRef>(null);
  const lift = useSharedValue(0);
  const size = useSharedValue(1);
  const was = useRef(on);
  useEffect(() => {
    if (was.current === on) return;
    was.current = on;
    if (level === 'off') return;
    if (on && level === 'full') {
      lift.set(
        repeatFinite(
          withTiming(-ambient.float.distance, {
            duration: ambient.float.duration / 2,
            easing: Easing.inOut(Easing.sin),
          }),
          timesAt(level, shortcutFx.ghostFloats),
          true,
        ),
      );
      return;
    }
    // Off (or on, when reduced): "pof", squeezed then just past its size, then back.
    size.set(
      withSequence(
        withTiming(shortcutFx.pof.squeeze, { duration: duration.fast / 2 }),
        withSpring(1, spring.bouncy),
      ),
    );
  }, [on, level, lift, size]);
  const floating = useAnimatedStyle(() => ({ transform: [{ translateY: lift.get() }] }));
  const popping = useAnimatedStyle(() => ({ transform: [{ scale: size.get() }] }));
  const name = t(`location.ghost.${mode}`);
  return (
    <View pointerEvents="box-none">
      <Animated.View style={popping}>
        <RoundButton
          testID="shortcut-ghost"
          icon={Ghost}
          tone={on ? 'primary' : 'raised'}
          selected={on}
          label={[
            t('map.shortcuts.ghostState', { mode: name }),
            shared ? t('map.shortcuts.shared') : null,
          ]
            .filter((part) => part !== null)
            .join(' ')}
          iconStyle={floating}
          badge={
            shared ? (
              <View
                testID="ghost-shared-dot"
                pointerEvents="none"
                style={[
                  styles.dot,
                  { backgroundColor: colors.primary, borderColor: colors.surfaceRaised },
                ]}
              />
            ) : null
          }
          onPress={() => {
            sheet.current?.present();
          }}
        />
      </Animated.View>
      <GhostSheet
        ref={sheet}
        circles={circles}
        now={now}
        onClose={() => sheet.current?.dismiss()}
      />
    </View>
  );
}

/**
 * "Geldim" for the meeting on the chip (no location in it, ADR 0026 §5): as it appears, a few rings
 * spread from it, then it stays still.
 */
function HereButton({
  circle,
  meetAt,
  place,
  level,
}: {
  circle: Circle;
  meetAt: number;
  place: Place;
  level: EffectLevel;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [sending, setSending] = useState(false);
  const ring = useSharedValue(1);
  useEffect(() => {
    const rings = timesAt(level, shortcutFx.hereRings);
    if (rings === 0) return;
    ring.set(0);
    ring.set(
      repeatFinite(
        withTiming(1, { duration: shortcutFx.ring.duration, easing: Easing.out(Easing.quad) }),
        rings,
      ),
    );
  }, [level, ring]);
  const say = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sayArrived(circle, meetAt);
      toast.success(t('meeting.hereSent'));
    } catch {
      toast.error(t('plan.failed'));
    } finally {
      setSending(false);
    }
  };
  return (
    <RoundButton
      testID="shortcut-here"
      icon={CircleCheck}
      tone="primary"
      label={t('map.shortcuts.here', { place: place.name })}
      behind={<Ring progress={ring} color={colors.primary} fx={shortcutFx.ring} />}
      onPress={() => {
        void say();
      }}
    />
  );
}

/** A ring spreading from a button and fading: `progress` 0 starts it, 1 is gone (and the rest). */
function Ring({
  progress,
  color,
  fx,
}: {
  progress: SharedValue<number>;
  color: string;
  fx: { scale: number; opacity: number };
}) {
  const style = useAnimatedStyle(() => {
    const p = progress.get();
    return { opacity: fx.opacity * (1 - p), transform: [{ scale: 1 + (fx.scale - 1) * p }] };
  });
  return (
    <Animated.View pointerEvents="none" style={[styles.ring, { borderColor: color }, style]} />
  );
}

/** A round shortcut: 48 pt, raised with a hairline, or filled when on; an effect drawn behind it. */
export function RoundButton({
  icon: Icon,
  label,
  onPress,
  tone = 'raised',
  selected,
  iconStyle,
  behind,
  badge,
  testID,
}: {
  icon: LucideIcon;
  label: string;
  onPress: () => void;
  tone?: 'raised' | 'primary';
  selected?: boolean;
  iconStyle?: ComponentProps<typeof Animated.View>['style'];
  behind?: ReactNode;
  /** A small sign on the button's corner. */
  badge?: ReactNode;
  testID: string;
}) {
  const { colors } = useTheme();
  const fill = tone === 'primary' ? colors.primary : colors.surfaceRaised;
  const ink = tone === 'primary' ? colors.onPrimary : colors.text;
  return (
    <View style={styles.slot}>
      {behind}
      <PressableScale
        testID={testID}
        onPress={onPress}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={selected === undefined ? undefined : { selected }}
        style={[
          styles.button,
          { backgroundColor: fill, borderColor: colors.border, boxShadow: elevation.raised },
        ]}
      >
        <Animated.View style={iconStyle}>
          <Icon color={ink} size={touchTarget * 0.46} strokeWidth={2.25} />
        </Animated.View>
      </PressableScale>
      {badge}
    </View>
  );
}

const styles = StyleSheet.create({
  // Right-aligned: the round buttons, the store's among them, are all one width.
  column: { position: 'absolute', right: space.lg, alignItems: 'flex-end', gap: space.sm },
  slot: { width: touchTarget, height: touchTarget },
  button: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    position: 'absolute',
    top: space.xxs,
    right: space.xxs,
    width: space.md,
    height: space.md,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
  ring: {
    position: 'absolute',
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    borderWidth: space.xxs,
  },
});
