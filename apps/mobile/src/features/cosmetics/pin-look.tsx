import type { FrameStyle, RingPattern } from '@bargu/schemas';
import { useEffect, useId } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { cosmeticFx, pinFx, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';

import { useAnimationSlot } from './animation-slots';
import {
  around,
  dotDashes,
  evenDashes,
  isMoving,
  type Look,
  lookColors,
  starPath,
} from './look-styles';

/** How far the drawing reaches beyond the pin's circle: the frame, its gap and the neon glow. */
const GLOW_REACH = Math.max(...cosmeticFx.glow.map((glow) => glow.reach));
const REACH = cosmeticFx.frame.gap + cosmeticFx.frame.width + GLOW_REACH;

export interface PinLookProps {
  look: Look;
  /** The pin's circle with its ring (px): the drawing is laid around it. */
  size: number;
  /** The pin's ring colour: the theme's navy, or grey for an old location. */
  ringColor: string;
  /** The location is old: the look is faint and still. */
  stale: boolean;
  /** Whose pin: the moving looks share a few places on the map. */
  id: string;
  /** The user's own pin (and the preview of it): always one of the moving ones. */
  mine?: boolean | undefined;
}

/**
 * A pin's look, drawn over its ring and around it (docs/ADR/0025 and its addendum of 2026-10-21):
 * a pattern on the ring and a frame outside it. Put inside the pin's circle, it ignores touches and
 * is hidden from screen readers (the pin's own label says who and where); it never reaches the
 * line of text under the pin. The moving styles (sparkle, holo, neon) move at sade mod "full" only
 * (so not in calm mode, with Reduce Motion or in battery saving: `useEffects`), not for an old
 * location, and only while the pin has one of the few places for it (animation-slots.ts).
 */
export function PinLook({ look, size, ringColor, stale, id, mine = false }: PinLookProps) {
  const level = useEffects();
  const wantsMotion = level === 'full' && !stale && isMoving(look);
  const moving = useAnimationSlot(id, wantsMotion, mine);
  const box = size + 2 * REACH;
  return (
    <View
      testID="pin-look"
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.layer,
        {
          top: -pinFx.ring - REACH,
          left: -pinFx.ring - REACH,
          width: box,
          height: box,
          opacity: stale ? cosmeticFx.staleOpacity : 1,
        },
      ]}
    >
      {look.frame === undefined ? null : (
        <Frame frame={look.frame} size={size} box={box} ringColor={ringColor} moving={moving} />
      )}
      {look.ring === undefined ? null : (
        <Ring ring={look.ring} size={size} box={box} ringColor={ringColor} moving={moving} />
      )}
    </View>
  );
}

/** A loop's progress, 0 to 1 once per period (and back, for a breath); still at 0 when not moving. */
function useLoop(moving: boolean, periodMs: number, breathing: boolean): SharedValue<number> {
  const phase = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(phase);
    phase.set(0);
    if (!moving) return;
    const lap = withTiming(1, {
      duration: periodMs,
      easing: breathing ? Easing.inOut(Easing.sin) : Easing.linear,
    });
    phase.set(withRepeat(lap, -1, breathing));
    return () => {
      cancelAnimation(phase);
    };
  }, [phase, moving, periodMs, breathing]);
  return phase;
}

/** Ids of an SVG's gradients must not clash with other pins': React's id, made safe for SVG. */
function useSvgId(): string {
  return useId().replace(/[^a-zA-Z0-9_-]/g, '');
}

interface PartProps {
  size: number;
  box: number;
  ringColor: string;
  moving: boolean;
}

function Ring({ ring, ...part }: PartProps & { ring: RingPattern }) {
  const { colors } = useTheme();
  const { size, box, ringColor, moving } = part;
  const gradient = useSvgId();
  const center = box / 2;
  // The middle of the pin's own ring: the pattern covers it and spills a little over each side.
  const radius = (size - pinFx.ring) / 2;
  const width = cosmeticFx.ringWidth;
  const base = (color: string) => (
    <Circle cx={center} cy={center} r={radius} stroke={color} strokeWidth={width} fill="none" />
  );
  if (ring === 'sparkle') {
    return <Sparkles box={box} ringColor={ringColor} radius={radius} moving={moving} />;
  }
  const stripes = evenDashes(radius, cosmeticFx.stripes);
  const dots = dotDashes(radius, cosmeticFx.dots);
  return (
    <Svg testID={`pin-look-ring-${ring}`} width={box} height={box} style={styles.fill}>
      {ring === 'stripes' ? (
        <>
          {base(colors.surfaceRaised)}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={ringColor}
            strokeWidth={width}
            strokeDasharray={[stripes.dash, stripes.gap]}
            fill="none"
          />
        </>
      ) : null}
      {ring === 'dots' ? (
        <>
          {base(ringColor)}
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={colors.accent}
            strokeWidth={width}
            strokeLinecap="round"
            strokeDasharray={[dots.dash, dots.gap]}
            fill="none"
          />
        </>
      ) : null}
      {ring === 'gradient' ? (
        <>
          <Defs>
            <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={ringColor} />
              <Stop offset="1" stopColor={colors.accent} />
            </LinearGradient>
          </Defs>
          {base(`url(#${gradient})`)}
        </>
      ) : null}
    </Svg>
  );
}

/** Light of one group of sparkles: `offset` of a lap behind the other, between the dimmest and 1. */
function twinkle(phase: number, offset: number): number {
  'worklet';
  const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (phase + offset));
  return cosmeticFx.sparkle.dimmest + (1 - cosmeticFx.sparkle.dimmest) * wave;
}

/** A ring with sparkles on it, in two groups that twinkle by turns while moving. */
function Sparkles({
  box,
  ringColor,
  moving,
  radius,
}: Omit<PartProps, 'size'> & { radius: number }) {
  const center = box / 2;
  const phase = useLoop(moving, cosmeticFx.sparkle.periodMs, false);
  const stars = around(center, radius, cosmeticFx.sparkles.count);
  const group = (parity: number) => (
    <Svg width={box} height={box} style={styles.fill}>
      {stars.map((star, index) =>
        index % 2 === parity ? (
          <Path
            key={index}
            d={starPath(star.x, star.y, cosmeticFx.sparkles.size)}
            fill={lookColors.sparkle}
          />
        ) : null,
      )}
    </Svg>
  );
  const first = useAnimatedStyle(() => ({ opacity: moving ? twinkle(phase.get(), 0) : 1 }));
  const second = useAnimatedStyle(() => ({ opacity: moving ? twinkle(phase.get(), 0.5) : 1 }));
  return (
    <View testID="pin-look-ring-sparkle" style={styles.fill}>
      <Svg width={box} height={box} style={styles.fill}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={ringColor}
          strokeWidth={cosmeticFx.ringWidth}
          fill="none"
        />
      </Svg>
      <Animated.View style={[styles.fill, first]}>{group(0)}</Animated.View>
      <Animated.View style={[styles.fill, second]}>{group(1)}</Animated.View>
    </View>
  );
}

function Frame({ frame, ...part }: PartProps & { frame: FrameStyle }) {
  if (frame === 'holo') return <HoloFrame {...part} />;
  if (frame === 'neon') return <NeonFrame {...part} />;
  return <StillFrame frame={frame} {...part} />;
}

/** The middle of a frame: outside the pin's circle by its gap and half its width. */
const frameRadius = (size: number) => size / 2 + cosmeticFx.frame.gap + cosmeticFx.frame.width / 2;

/** Gold (a metal gradient with a dark rim) and dashed: they do not move. */
function StillFrame({
  frame,
  size,
  box,
  ringColor,
}: PartProps & { frame: Extract<FrameStyle, 'gold' | 'dashed'> }) {
  const gradient = useSvgId();
  const center = box / 2;
  const radius = frameRadius(size);
  const { width } = cosmeticFx.frame;
  return (
    <Svg testID={`pin-look-frame-${frame}`} width={box} height={box} style={styles.fill}>
      {frame === 'gold' ? (
        <>
          <Defs>
            <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              {lookColors.gold.map((color, index) => (
                <Stop key={index} offset={index / (lookColors.gold.length - 1)} stopColor={color} />
              ))}
            </LinearGradient>
          </Defs>
          <Circle
            cx={center}
            cy={center}
            r={radius}
            stroke={`url(#${gradient})`}
            strokeWidth={width}
            fill="none"
          />
          <Circle
            cx={center}
            cy={center}
            r={radius + width / 2}
            stroke={lookColors.goldRim}
            strokeWidth={1}
            fill="none"
          />
        </>
      ) : (
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={ringColor}
          strokeWidth={width}
          strokeLinecap="round"
          strokeDasharray={[cosmeticFx.dash.length, cosmeticFx.dash.gap]}
          fill="none"
        />
      )}
    </Svg>
  );
}

/** A rainbow sheen around the pin, turning once in a while when it moves. */
function HoloFrame({ size, box, moving }: PartProps) {
  const gradient = useSvgId();
  const center = box / 2;
  const phase = useLoop(moving, cosmeticFx.holo.periodMs, false);
  const turning = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(phase.get() * 360)}deg` }],
  }));
  return (
    <Animated.View testID="pin-look-frame-holo" style={[styles.fill, turning]}>
      <Svg width={box} height={box} style={styles.fill}>
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            {lookColors.holo.map((color, index) => (
              <Stop key={index} offset={index / (lookColors.holo.length - 1)} stopColor={color} />
            ))}
          </LinearGradient>
        </Defs>
        <Circle
          cx={center}
          cy={center}
          r={frameRadius(size)}
          stroke={`url(#${gradient})`}
          strokeWidth={cosmeticFx.frame.width}
          fill="none"
        />
      </Svg>
    </Animated.View>
  );
}

/** A bright line with a glow that breathes while it moves. */
function NeonFrame({ size, box, moving }: PartProps) {
  const center = box / 2;
  const phase = useLoop(moving, cosmeticFx.neon.periodMs, true);
  const breathing = useAnimatedStyle(() => ({
    opacity: 1 - phase.get() * (1 - cosmeticFx.neon.dimmest),
  }));
  const radius = frameRadius(size);
  return (
    <View testID="pin-look-frame-neon" style={styles.fill}>
      <Animated.View style={[styles.fill, breathing]}>
        <Svg width={box} height={box} style={styles.fill}>
          {cosmeticFx.glow.map((glow) => {
            // From the pin's edge outwards: the glow never reaches over the pin itself.
            const width = cosmeticFx.frame.gap + cosmeticFx.frame.width + glow.reach;
            return (
              <Circle
                key={glow.reach}
                cx={center}
                cy={center}
                r={size / 2 + width / 2}
                stroke={lookColors.neon}
                strokeOpacity={glow.opacity}
                strokeWidth={width}
                fill="none"
              />
            );
          })}
        </Svg>
      </Animated.View>
      <Svg width={box} height={box} style={styles.fill}>
        {/* A darker line under the bright one, so that it also shows on a light map. */}
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={lookColors.neonRim}
          strokeWidth={cosmeticFx.frame.width + 1}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={lookColors.neon}
          strokeWidth={cosmeticFx.frame.width}
          fill="none"
        />
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute' },
  fill: { ...StyleSheet.absoluteFill },
});
