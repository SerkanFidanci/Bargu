import { useEffect } from 'react';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, G, Path } from 'react-native-svg';

import { ambient, avatarPalette, spring, timing, useTheme } from '@/theme';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedG = Animated.createAnimatedComponent(G);

const SIZE = 220;

/** SVG path of a rounded rectangle (react-native-svg types mark Rect x/y as deprecated). */
function roundedRect(x: number, y: number, width: number, height: number, r: number): string {
  const right = x + width;
  const bottom = y + height;
  return [
    `M${String(x + r)} ${String(y)} H${String(right - r)}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(right)} ${String(y + r)} V${String(bottom - r)}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(right - r)} ${String(bottom)} H${String(x + r)}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(x)} ${String(bottom - r)} V${String(y + r)}`,
    `A${String(r)} ${String(r)} 0 0 1 ${String(x + r)} ${String(y)} Z`,
  ].join(' ');
}
/** Precision rings: exact, neighbourhood, city. */
const RINGS = [22, 52, 84] as const;

export interface IllustrationProps {
  /** Animates only while its page is on screen. */
  active: boolean;
}

/** A padlock closing over a location pin: only friends hold the key. */
export function LockedIllustration({ active }: IllustrationProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const shackle = useSharedValue(reduced ? 0 : -14);

  useEffect(() => {
    if (reduced) {
      shackle.set(0);
      return;
    }
    if (!active) {
      shackle.set(-14);
      return;
    }
    shackle.set(withDelay(timing.base.duration, withSpring(0, spring.bouncy)));
  }, [active, reduced, shackle]);

  const shackleProps = useAnimatedProps(() => ({ translateY: shackle.get() }));

  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 220 220" accessible={false}>
      <Path d={roundedRect(20, 20, 180, 180, 40)} fill={colors.primarySoft} />
      <Path
        d="M40 80 H180 M40 140 H180 M80 40 V180 M140 40 V180"
        stroke={colors.surfaceRaised}
        strokeWidth={6}
        strokeLinecap="round"
      />
      <Path
        d="M110 50 C84 50 66 69 66 93 C66 124 110 166 110 166 C110 166 154 124 154 93 C154 69 136 50 110 50 Z"
        fill={colors.primary}
      />
      <AnimatedG animatedProps={shackleProps}>
        <Path
          d="M98 96 V86 C98 79 103 74 110 74 C117 74 122 79 122 86 V96"
          stroke={colors.onPrimary}
          strokeWidth={6}
          fill="none"
          strokeLinecap="round"
        />
      </AnimatedG>
      <Path d={roundedRect(92, 94, 36, 28, 7)} fill={colors.onPrimary} />
      <Circle cx={110} cy={107} r={4} fill={colors.primary} />
    </Svg>
  );
}

/** A dot with three rings — exact, neighbourhood, city — the highlight stepping outwards. */
export function PrecisionIllustration({ active }: IllustrationProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const ring = useSharedValue<number>(RINGS[1]);

  useEffect(() => {
    if (reduced || !active) {
      cancelAnimation(ring);
      ring.set(RINGS[1]);
      return;
    }
    const step = (radius: number) =>
      withDelay(ambient.illustrationHold, withSpring(radius, spring.gentle));
    ring.set(withRepeat(withSequence(step(RINGS[2]), step(RINGS[0]), step(RINGS[1])), -1));
    return () => {
      cancelAnimation(ring);
    };
  }, [active, reduced, ring]);

  const highlight = useAnimatedProps(() => ({ r: ring.get() }));

  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 220 220" accessible={false}>
      {RINGS.map((radius) => (
        <Circle
          key={radius}
          cx={110}
          cy={110}
          r={radius}
          stroke={colors.border}
          strokeWidth={3}
          strokeDasharray="6 8"
          fill="none"
        />
      ))}
      <AnimatedCircle
        animatedProps={highlight}
        cx={110}
        cy={110}
        fill={colors.primary}
        fillOpacity={0.16}
        stroke={colors.primary}
        strokeWidth={4}
      />
      <Circle cx={110} cy={110} r={14} fill={avatarPalette[9] ?? colors.primary} />
      <Circle cx={110} cy={110} r={5} fill={colors.onPrimary} />
    </Svg>
  );
}

/** An avatar that fades into a ghost and back: ghost mode in one tap. */
export function GhostIllustration({ active }: IllustrationProps) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const ghost = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    if (reduced) {
      ghost.set(1);
      return;
    }
    if (!active) {
      cancelAnimation(ghost);
      ghost.set(0);
      return;
    }
    const fade = (to: number) =>
      withDelay(
        ambient.illustrationHold,
        withTiming(to, { duration: ambient.ghostFade, easing: Easing.inOut(Easing.cubic) }),
      );
    ghost.set(withRepeat(withSequence(fade(1), fade(0)), -1));
    return () => {
      cancelAnimation(ghost);
    };
  }, [active, ghost, reduced]);

  const person = useAnimatedProps(() => ({ opacity: 1 - ghost.get() }));
  const spirit = useAnimatedProps(() => ({ opacity: ghost.get() }));

  return (
    <Svg width={SIZE} height={SIZE} viewBox="0 0 220 220" accessible={false}>
      <Path d={roundedRect(20, 20, 180, 180, 40)} fill={colors.surface} />
      <AnimatedG animatedProps={person}>
        <Circle cx={110} cy={104} r={46} fill={avatarPalette[0] ?? colors.primary} />
        <Circle cx={95} cy={96} r={6} fill={colors.onPrimary} />
        <Circle cx={125} cy={96} r={6} fill={colors.onPrimary} />
        <Path
          d="M92 118 Q110 132 128 118"
          stroke={colors.onPrimary}
          strokeWidth={5}
          fill="none"
          strokeLinecap="round"
        />
      </AnimatedG>
      <AnimatedG animatedProps={spirit}>
        <Path
          d="M70 160 V104 C70 80 88 62 110 62 C132 62 150 80 150 104 V160 L137 148 L124 160 L110 148 L96 160 L83 148 Z"
          fill={colors.ghost}
          fillOpacity={0.55}
        />
        <Circle cx={96} cy={102} r={7} fill={colors.text} />
        <Circle cx={124} cy={102} r={7} fill={colors.text} />
      </AnimatedG>
    </Svg>
  );
}
