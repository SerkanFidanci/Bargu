import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';

import { useTheme } from '@/theme';

import { limbAngles, PEDAL_SEGMENT, pedalLeg, type GlyphActivity } from './activity-glyph-pose';

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/** The drawing is laid out on a 28 × 28 grid (px). */
export const GLYPH = 28;
const LIMB = 2.2;

/** A straight bar from (ax, ay) to (bx, by), drawn as a rotated rectangle. */
function bar(ax: number, ay: number, bx: number, by: number, thickness = 1.6): ViewStyle {
  const length = Math.hypot(bx - ax, by - ay);
  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
  return {
    position: 'absolute',
    left: (ax + bx) / 2 - length / 2,
    top: (ay + by) / 2 - thickness / 2,
    width: length,
    height: thickness,
    borderRadius: thickness / 2,
    transform: [{ rotate: `${String(angle)}deg` }],
  };
}

function circle(cx: number, cy: number, diameter: number): ViewStyle {
  return {
    position: 'absolute',
    left: cx - diameter / 2,
    top: cy - diameter / 2,
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
  };
}

/** A limb hanging from (x, y): a thigh or upper arm with a shin or forearm hinged at its end. */
function Limb({
  x,
  y,
  upper,
  lower,
  color,
  upperStyle,
  lowerStyle,
}: {
  x: number;
  y: number;
  upper: number;
  lower: number;
  color: string;
  upperStyle: AnimatedViewStyle;
  lowerStyle: AnimatedViewStyle;
}) {
  return (
    <Animated.View
      style={[
        styles.limb,
        { left: x - LIMB / 2, top: y, height: upper, backgroundColor: color },
        upperStyle,
      ]}
    >
      <Animated.View
        style={[
          styles.limb,
          { left: 0, top: upper - LIMB / 2, height: lower, backgroundColor: color },
          lowerStyle,
        ]}
      />
    </Animated.View>
  );
}

/** Someone walking or running: legs and arms swing with the gait, knees bend when running. */
function Figure({
  phase,
  running,
  color,
}: {
  phase: SharedValue<number>;
  running: boolean;
  color: string;
}) {
  const pose = (side: 0 | 1) => () => {
    'worklet';
    return limbAngles(phase.get(), running, side);
  };
  const legA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pose(0)().thigh)}deg` }],
  }));
  const shinA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pose(0)().shin)}deg` }],
  }));
  const legB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pose(1)().thigh)}deg` }],
  }));
  const shinB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pose(1)().shin)}deg` }],
  }));
  const armA = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(pose(0)().arm)}deg` }] }));
  const foreA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pose(0)().forearm)}deg` }],
  }));
  const armB = useAnimatedStyle(() => ({ transform: [{ rotate: `${String(pose(1)().arm)}deg` }] }));
  const foreB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pose(1)().forearm)}deg` }],
  }));
  const lean = running ? 16 : 5;
  const thigh = running ? 5.5 : 6;
  return (
    <View style={StyleSheet.absoluteFill}>
      {/* The far leg and arm first, so the near ones are drawn over them. */}
      <Limb
        x={14}
        y={16}
        upper={thigh}
        lower={thigh}
        color={color}
        upperStyle={legB}
        lowerStyle={shinB}
      />
      <View style={[styles.upperBody, { transform: [{ rotate: `${String(lean)}deg` }] }]}>
        <Limb
          x={14}
          y={9}
          upper={4.5}
          lower={4}
          color={color}
          upperStyle={armB}
          lowerStyle={foreB}
        />
        <View style={[bar(14, 9, 14, 16, LIMB + 0.4), { backgroundColor: color }]} />
        <View style={[circle(14, 5, 5.5), { backgroundColor: color }]} />
        <Limb
          x={14}
          y={9}
          upper={4.5}
          lower={4}
          color={color}
          upperStyle={armA}
          lowerStyle={foreA}
        />
      </View>
      <Limb
        x={14}
        y={16}
        upper={thigh}
        lower={thigh}
        color={color}
        upperStyle={legA}
        lowerStyle={shinA}
      />
    </View>
  );
}

/** A wheel whose spokes turn `turns` times per cycle. */
function Wheel({
  cx,
  cy,
  diameter,
  phase,
  turns,
  color,
  hub,
}: {
  cx: number;
  cy: number;
  diameter: number;
  phase: SharedValue<number>;
  turns: number;
  color: string;
  hub: string;
}) {
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(phase.get() * 360 * turns)}deg` }],
  }));
  return (
    <View style={[circle(cx, cy, diameter), { borderWidth: 1.4, borderColor: color }]}>
      <Animated.View style={[StyleSheet.absoluteFill, spin]}>
        <View
          style={[
            bar(diameter / 2 - 1.4, 0, diameter / 2 - 1.4, diameter - 2.8, 1),
            { backgroundColor: hub },
          ]}
        />
        <View
          style={[
            bar(0, diameter / 2 - 1.4, diameter - 2.8, diameter / 2 - 1.4, 1),
            { backgroundColor: hub },
          ]}
        />
      </Animated.View>
    </View>
  );
}

/** Someone cycling: wheels turn, the legs follow the pedals round. */
function Bike({
  phase,
  color,
  frame,
}: {
  phase: SharedValue<number>;
  color: string;
  frame: string;
}) {
  const leg = (side: 0 | 1) => () => {
    'worklet';
    return pedalLeg(phase.get(), side);
  };
  const thighA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(leg(0)().thigh)}deg` }],
  }));
  const shinA = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(leg(0)().shin)}deg` }],
  }));
  const thighB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(leg(1)().thigh)}deg` }],
  }));
  const shinB = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(leg(1)().shin)}deg` }],
  }));
  return (
    <View style={StyleSheet.absoluteFill}>
      <Wheel cx={7} cy={21} diameter={10} phase={phase} turns={2} color={color} hub={color} />
      <Wheel cx={21} cy={21} diameter={10} phase={phase} turns={2} color={color} hub={color} />
      <Limb
        x={11}
        y={13}
        upper={PEDAL_SEGMENT}
        lower={PEDAL_SEGMENT}
        color={color}
        upperStyle={thighB}
        lowerStyle={shinB}
      />
      <View style={[bar(7, 21, 14, 21), { backgroundColor: frame }]} />
      <View style={[bar(14, 21, 11, 13), { backgroundColor: frame }]} />
      <View style={[bar(11, 13, 19, 13), { backgroundColor: frame }]} />
      <View style={[bar(14, 21, 19, 13), { backgroundColor: frame }]} />
      <View style={[bar(19, 12, 21, 21), { backgroundColor: frame }]} />
      <View style={[bar(11, 13, 16, 6, LIMB + 0.2), { backgroundColor: color }]} />
      <View style={[bar(16, 7, 19.5, 11.5), { backgroundColor: color }]} />
      <View style={[circle(17, 3.5, 5), { backgroundColor: color }]} />
      <Limb
        x={11}
        y={13}
        upper={PEDAL_SEGMENT}
        lower={PEDAL_SEGMENT}
        color={color}
        upperStyle={thighA}
        lowerStyle={shinA}
      />
    </View>
  );
}

/** Someone in a car: wheels spin and little puffs drift from the exhaust. */
function Car({
  phase,
  color,
  body,
  window,
}: {
  phase: SharedValue<number>;
  color: string;
  body: string;
  window: string;
}) {
  const puff = (offset: number) => () => {
    'worklet';
    const t = (phase.get() + offset) % 1;
    return {
      opacity: 0.6 * (1 - t),
      transform: [{ translateX: -5 * t }, { translateY: -2 * t }, { scale: 0.6 + t }],
    };
  };
  const puffA = useAnimatedStyle(puff(0));
  const puffB = useAnimatedStyle(puff(0.5));
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View style={[circle(2.5, 17.5, 3), { backgroundColor: color }, puffA]} />
      <Animated.View style={[circle(2.5, 17.5, 3), { backgroundColor: color }, puffB]} />
      <View style={[styles.cabin, { backgroundColor: body }]}>
        <View style={[styles.window, { backgroundColor: window }]} />
      </View>
      <View style={[styles.carBody, { backgroundColor: body }]} />
      <Wheel cx={9} cy={20.5} diameter={6.5} phase={phase} turns={1} color={color} hub={window} />
      <Wheel cx={20} cy={20.5} diameter={6.5} phase={phase} turns={1} color={color} hub={window} />
    </View>
  );
}

/** In one place for a while: a little clock whose minute hand goes round. */
function Clock({ phase, color }: { phase: SharedValue<number>; color: string }) {
  const minute = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(phase.get() * 360)}deg` }],
  }));
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[circle(14, 14, 19), { borderWidth: 1.6, borderColor: color }]} />
      {[0, 90, 180, 270].map((angle) => (
        <View
          key={angle}
          style={[
            circle(
              14 + 6.3 * Math.sin((angle * Math.PI) / 180),
              14 - 6.3 * Math.cos((angle * Math.PI) / 180),
              1.6,
            ),
            { backgroundColor: color },
          ]}
        />
      ))}
      <View style={[styles.hourHand, { backgroundColor: color }]} />
      <Animated.View style={[styles.minuteHand, { backgroundColor: color }, minute]} />
      <View style={[circle(14, 14, 3), { backgroundColor: color }]} />
    </View>
  );
}

/**
 * A small drawn animation of what someone is doing, instead of an emoji (owner's request): a
 * walker, a runner, a cyclist, a car, or a clock when they have stayed put. Driven by the same
 * phase as the pin's own motion, so steps and swings match; turned to face their direction.
 */
export function ActivityGlyph({
  activity,
  phase,
  facing,
}: {
  activity: GlyphActivity;
  phase: SharedValue<number>;
  /** 1: facing east (right on the north-up map), -1: west. */
  facing: 1 | -1;
}) {
  const { colors } = useTheme();
  const ink = colors.text;
  let drawing: ReactNode;
  switch (activity) {
    case 'walking':
    case 'running':
      drawing = <Figure phase={phase} running={activity === 'running'} color={ink} />;
      break;
    case 'cycling':
      drawing = <Bike phase={phase} color={ink} frame={colors.primary} />;
      break;
    case 'driving':
      drawing = (
        <Car phase={phase} color={ink} body={colors.primary} window={colors.surfaceRaised} />
      );
      break;
    case 'settled':
      drawing = <Clock phase={phase} color={ink} />;
      break;
  }
  return (
    <View
      style={[styles.glyph, activity === 'settled' ? null : { transform: [{ scaleX: facing }] }]}
      pointerEvents="none"
    >
      {drawing}
    </View>
  );
}

const styles = StyleSheet.create({
  glyph: { width: GLYPH, height: GLYPH },
  limb: { position: 'absolute', width: LIMB, borderRadius: LIMB / 2, transformOrigin: '50% 0%' },
  // Rotates around the hip, so leaning keeps the legs where they are.
  upperBody: { ...StyleSheet.absoluteFill, transformOrigin: [14, 16, 0] },
  carBody: { position: 'absolute', left: 3, top: 13, width: 22, height: 7, borderRadius: 3 },
  cabin: {
    position: 'absolute',
    left: 8,
    top: 8,
    width: 12,
    height: 6,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 3,
  },
  window: { position: 'absolute', left: 2.5, top: 1.5, width: 7, height: 3, borderRadius: 1 },
  hourHand: {
    position: 'absolute',
    left: 14 - 0.9,
    top: 14 - 4.5,
    width: 1.8,
    height: 4.5,
    borderRadius: 1,
    transformOrigin: '50% 100%',
    transform: [{ rotate: '120deg' }],
  },
  minuteHand: {
    position: 'absolute',
    left: 14 - 0.7,
    top: 14 - 7,
    width: 1.4,
    height: 7,
    borderRadius: 1,
    transformOrigin: '50% 100%',
  },
});
