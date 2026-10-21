import type { ComponentProps, ReactNode } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { type SharedValue, useAnimatedStyle } from 'react-native-reanimated';
import Svg, { Circle, Ellipse, Line, Path } from 'react-native-svg';

import { activityFx, drawingColors, drawingParts as part, useTheme } from '@/theme';

import { BIKE, FIGURE, type GlyphActivity, pedalPose, stridePose } from './activity-glyph-pose';

type AnimatedViewStyle = ComponentProps<typeof Animated.View>['style'];

/** The clock of someone settled is drawn on a 28 × 28 grid (px). */
export const GLYPH = 28;
/** The badge on the pin: round for people on foot, wide for wheels, rails and wings (px). */
export const BADGE_ROUND = 34;
export const BADGE_WIDE = { width: 54, height: 33 } as const;
/** The drawings' own grids: people 48 × 48, vehicles 72 × 44 (the approved preview's units). */
const PERSON_GRID = 48;
const VEHICLE_GRID = { width: 72, height: 44 } as const;
/** Limbs behind the body are drawn this faint (depth). */
const FAR = 0.45;

/** Whether the activity is drawn wide (wheels, rails, wings) or round (on foot, settled). */
export function wideGlyph(activity: GlyphActivity): boolean {
  return activity !== 'walking' && activity !== 'running' && activity !== 'settled';
}

/** The fractional part: where in its own cycle something is. */
function frac(value: number): number {
  'worklet';
  return value - Math.floor(value);
}

/** A round-ended bar hanging from its top centre at (x, y), turning about that point. */
function bar(x: number, y: number, length: number, thickness: number): ViewStyle {
  return {
    position: 'absolute',
    left: x - thickness / 2,
    top: y,
    width: thickness,
    height: length,
    borderRadius: thickness / 2,
    transformOrigin: '50% 0%',
  };
}

function disc(cx: number, cy: number, diameter: number): ViewStyle {
  return {
    position: 'absolute',
    left: cx - diameter / 2,
    top: cy - diameter / 2,
    width: diameter,
    height: diameter,
    borderRadius: diameter / 2,
  };
}

/** A rectangle with rounded corners as an SVG path (x, y: its top left). */
function box(x: number, y: number, width: number, height: number, r = 0): string {
  const right = x + width;
  const bottom = y + height;
  return [
    `M${String(x + r)} ${String(y)}`,
    `L${String(right - r)} ${String(y)}`,
    `Q${String(right)} ${String(y)} ${String(right)} ${String(y + r)}`,
    `L${String(right)} ${String(bottom - r)}`,
    `Q${String(right)} ${String(bottom)} ${String(right - r)} ${String(bottom)}`,
    `L${String(x + r)} ${String(bottom)}`,
    `Q${String(x)} ${String(bottom)} ${String(x)} ${String(bottom - r)}`,
    `L${String(x)} ${String(y + r)}`,
    `Q${String(x)} ${String(y)} ${String(x + r)} ${String(y)} Z`,
  ].join(' ');
}

/**
 * Degrees as a hanging bar turns: forward (to the right) is a negative rotation. A worklet: the
 * animated styles call it on the UI thread, where a plain function throws on every frame (the
 * freeze of bc5f925).
 */
function turn(forward: number): string {
  'worklet';
  return `${String(-forward)}deg`;
}

/**
 * Someone walking or running, the way the owner approved it (2026-10-21): their shirt in their own
 * colour, the far limbs fainter, knees and elbows that bend, the runner leaning and in the air for
 * a moment, the body rising and falling with each step.
 */
function Figure({
  phase,
  running,
  ink,
  pants,
  shirt,
}: {
  phase: SharedValue<number>;
  running: boolean;
  ink: string;
  pants: string;
  shirt: string;
}) {
  const size = running ? FIGURE.run : FIGURE.walk;
  const { hip } = FIGURE;
  // Only worklets run in these styles (the UI thread): stridePose is one.
  const body = useAnimatedStyle(() => ({
    transform: [{ translateY: stridePose(phase.get(), running).dy }],
  }));
  const nearThigh = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(stridePose(phase.get(), running).near.thigh) }],
  }));
  const nearShin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(stridePose(phase.get(), running).near.knee)}deg` }],
  }));
  const nearFoot = useAnimatedStyle(() => {
    const pose = stridePose(phase.get(), running).near;
    return { transform: [{ rotate: `${String(pose.thigh - pose.knee)}deg` }] };
  });
  const farThigh = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(stridePose(phase.get(), running).far.thigh) }],
  }));
  const farShin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(stridePose(phase.get(), running).far.knee)}deg` }],
  }));
  const farFoot = useAnimatedStyle(() => {
    const pose = stridePose(phase.get(), running).far;
    return { transform: [{ rotate: `${String(pose.thigh - pose.knee)}deg` }] };
  });
  // The arms hang inside the leaning upper body: their own swing, less the lean.
  const nearArm = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(stridePose(phase.get(), running).nearArm.arm - size.lean) }],
  }));
  const nearFore = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(stridePose(phase.get(), running).nearArm.fore) }],
  }));
  const farArm = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(stridePose(phase.get(), running).farArm.arm - size.lean) }],
  }));
  const farFore = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(stridePose(phase.get(), running).farArm.fore) }],
  }));
  const shoulderY = hip.y - size.torso;
  const leg = (thigh: AnimatedViewStyle, shin: AnimatedViewStyle, foot: AnimatedViewStyle) => (
    <Animated.View style={[bar(hip.x, hip.y, size.thigh, 4.2), { backgroundColor: pants }, thigh]}>
      <Animated.View
        style={[bar(2.1, size.thigh - 1.8, size.shin, 3.6), { backgroundColor: pants }, shin]}
      >
        <Animated.View
          style={[
            styles.foot,
            { top: size.shin - 1.3, backgroundColor: ink, transformOrigin: '0% 50%' },
            foot,
          ]}
        />
      </Animated.View>
    </Animated.View>
  );
  const armOf = (upper: AnimatedViewStyle, fore: AnimatedViewStyle) => (
    <Animated.View
      style={[bar(hip.x, shoulderY + 1, size.arm, 3.3), { backgroundColor: shirt }, upper]}
    >
      <Animated.View
        style={[bar(1.65, size.arm - 1.4, size.fore, 2.7), { backgroundColor: ink }, fore]}
      />
    </Animated.View>
  );
  const lean = { transform: [{ rotate: `${String(size.lean)}deg` }] };
  return (
    <Animated.View style={[styles.person, body]}>
      <View style={[StyleSheet.absoluteFill, { opacity: FAR }]}>
        {leg(farThigh, farShin, farFoot)}
      </View>
      <View style={[styles.upperBody, lean]}>
        <View style={[StyleSheet.absoluteFill, { opacity: FAR }]}>{armOf(farArm, farFore)}</View>
        <View
          style={[bar(hip.x, shoulderY - 1.6, size.torso + 0.4, 6.6), { backgroundColor: shirt }]}
        />
        <View style={[bar(hip.x + 0.3, shoulderY - 3.2, 3.6, 2.4), { backgroundColor: ink }]} />
        <View style={[disc(hip.x + 0.6, shoulderY - 5.6, 9), { backgroundColor: ink }]} />
      </View>
      {leg(nearThigh, nearShin, nearFoot)}
      <View style={[styles.upperBody, lean]}>{armOf(nearArm, nearFore)}</View>
    </Animated.View>
  );
}

/** A wheel turning `turns` times a cycle; past `blurTurns` a smooth disc, as a camera shows it. */
function Wheel({
  cx,
  cy,
  r,
  phase,
  turns,
  spokes,
  tire,
  rim,
  edge,
}: {
  cx: number;
  cy: number;
  r: number;
  phase: SharedValue<number>;
  turns: number;
  spokes: number;
  tire: string;
  rim: string;
  edge: string;
}) {
  const spin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(frac(phase.get() * turns) * 360)}deg` }],
  }));
  const blur = Math.min(
    1,
    Math.max(0, (turns - activityFx.drive.blurTurns) / activityFx.drive.blurTurns),
  );
  const size = r * 2;
  return (
    <View style={[styles.layer, disc(cx, cy, size)]}>
      <Svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`}>
        <Circle cx={r} cy={r} r={r - 0.4} fill={tire} stroke={edge} strokeWidth={0.8} />
        <Circle cx={r} cy={r} r={r * 0.6} fill={rim} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, spin]}>
        <Svg width={size} height={size} viewBox={`0 0 ${String(size)} ${String(size)}`}>
          {Array.from({ length: spokes }, (_, index) => {
            const angle = (index / spokes) * 2 * Math.PI;
            return (
              <Line
                key={index}
                x1={r}
                y1={r}
                x2={r + r * 0.56 * Math.cos(angle)}
                y2={r + r * 0.56 * Math.sin(angle)}
                stroke={tire}
                strokeWidth={1.1}
                strokeLinecap="round"
              />
            );
          })}
        </Svg>
      </Animated.View>
      <View style={[disc(r, r, r * 1.2), { backgroundColor: rim, opacity: blur * 0.85 }]} />
      <View style={[disc(r, r, r * 0.32), { backgroundColor: tire }]} />
    </View>
  );
}

/** Dashes on the road (or a track's sleepers) passing `count` dash lengths a cycle. */
function Passing({
  y,
  period,
  count,
  dash,
  thickness,
  color,
  phase,
}: {
  y: number;
  period: number;
  count: number;
  dash: number;
  thickness: number;
  color: string;
  phase: SharedValue<number>;
}) {
  const move = useAnimatedStyle(() => ({
    transform: [{ translateX: -frac(phase.get() * count) * period }],
  }));
  const width = VEHICLE_GRID.width + period * 2;
  return (
    <Animated.View
      style={[
        styles.layer,
        { left: -period, top: y - thickness / 2, width, height: thickness },
        move,
      ]}
    >
      <Svg width={width} height={thickness} viewBox={`0 0 ${String(width)} ${String(thickness)}`}>
        <Line
          x1={0}
          y1={thickness / 2}
          x2={width}
          y2={thickness / 2}
          stroke={color}
          strokeWidth={thickness}
          strokeDasharray={`${String(dash)} ${String(period - dash)}`}
        />
      </Svg>
    </Animated.View>
  );
}

/** Lines streaming past to the back, each `offset` of a cycle after the one before. */
function Streak({
  y,
  length,
  from,
  travel,
  times,
  offset,
  color,
  phase,
  fade = false,
}: {
  y: number;
  length: number;
  from: number;
  travel: number;
  times: number;
  offset: number;
  color: string;
  phase: SharedValue<number>;
  fade?: boolean;
}) {
  const move = useAnimatedStyle(() => {
    const life = frac(phase.get() * times + offset);
    return {
      opacity: fade ? Math.sin(Math.PI * life) : 1,
      transform: [{ translateX: -life * travel }],
    };
  });
  return (
    <Animated.View
      style={[
        styles.layer,
        { left: from, top: y - 0.55, width: length, height: 1.1, borderRadius: 0.55 },
        { backgroundColor: color },
        move,
      ]}
    />
  );
}

/** A puff of smoke from the exhaust: it drifts back and up, grows and fades. */
function Puff({
  phase,
  offset,
  color,
}: {
  phase: SharedValue<number>;
  offset: number;
  color: string;
}) {
  const drift = useAnimatedStyle(() => {
    const life = frac(phase.get() + offset);
    return {
      opacity: 0.55 * (1 - life),
      transform: [
        { translateX: -7 * life },
        { translateY: -3 * life },
        { scale: 0.75 + 1.25 * life },
      ],
    };
  });
  return <Animated.View style={[disc(5, 30.5, 3.2), { backgroundColor: color }, drift]} />;
}

/** A vehicle's body rising and falling `bobs` times a cycle, by `lift` grid units. */
function useBob(phase: SharedValue<number>, lift: number) {
  return useAnimatedStyle(() => ({
    transform: [{ translateY: lift * Math.sin(phase.get() * 2 * Math.PI * activityFx.drive.bobs) }],
  }));
}

interface VehicleProps {
  phase: SharedValue<number>;
  /** km/h, rounded: how fast the wheels turn and the road passes. */
  kmh: number;
  ink: string;
  mark: string;
  glass: string;
  tire: string;
  rim: string;
  /** Their own colour (their avatar's). */
  paint: string;
}

const wheelTurns = (kmh: number) =>
  Math.min(activityFx.drive.maxTurns, Math.max(1, Math.round(kmh * activityFx.drive.turnsPerKmh)));
const roadDashes = (kmh: number) =>
  Math.min(
    activityFx.drive.maxDashes,
    Math.max(1, Math.round(kmh * activityFx.drive.dashesPerKmh)),
  );

/** In a car: wheels turning with the speed, smoke in town, the air streaming past on the road. */
function Car({ phase, kmh, mark, glass, tire, rim, paint }: VehicleProps) {
  const bob = useBob(phase, kmh < activityFx.drive.smokeBelow * 3.6 ? 0.55 : 0.25);
  const turns = wheelTurns(kmh);
  const town = kmh < activityFx.drive.smokeBelow * 3.6;
  return (
    <>
      <Passing
        y={42.2}
        period={12}
        dash={6}
        count={roadDashes(kmh)}
        thickness={1.3}
        color={mark}
        phase={phase}
      />
      {town
        ? [0, 1 / 3, 2 / 3].map((offset) => (
            <Puff key={offset} phase={phase} offset={offset} color={mark} />
          ))
        : [0, 0.5].map((offset, index) => (
            <Streak
              key={offset}
              y={15 + index * 7}
              length={8}
              from={4}
              travel={12}
              times={kmh >= 110 ? 2 : 1}
              offset={offset}
              color={mark}
              phase={phase}
              fade
            />
          ))}
      <Svg style={styles.layer} width={72} height={44} viewBox="0 0 72 44">
        <Ellipse cx={37} cy={40.2} rx={30} ry={2} fill={part.shadow} opacity={0.18} />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, bob]}>
        <Svg width={72} height={44} viewBox="0 0 72 44">
          <Path
            fill={paint}
            d="M6 31 L6 24 Q6 21 9 20.5 L17 19 L24 11.6 Q26 10 29 10 L45 10 Q48 10 50 12 L57 18.6 L64 20 Q68 21 68 25 L68 30 Q68 32 66 32 L61 32 A8 8 0 0 0 45 32 L27 32 A8 8 0 0 0 11 32 L8 32 Q6 32 6 31 Z"
          />
          <Path fill={glass} d="M19.6 19 L25.4 12.7 Q26.4 11.7 28 11.7 L36.4 11.7 L36.4 19 Z" />
          <Path fill={glass} d="M38.6 11.7 L45 11.7 Q47 11.7 48.4 13.1 L54 18.7 L38.6 19 Z" />
          <Line
            x1={37.5}
            y1={19.6}
            x2={37.5}
            y2={30.5}
            stroke={part.shadow}
            strokeOpacity={0.25}
            strokeWidth={0.7}
          />
          <Line
            x1={41.5}
            y1={21.6}
            x2={44.5}
            y2={21.6}
            stroke={part.shadow}
            strokeOpacity={0.3}
            strokeWidth={0.9}
            strokeLinecap="round"
          />
          <Path
            fill="none"
            stroke={part.shine}
            strokeOpacity={0.28}
            strokeWidth={0.9}
            d="M9 22.2 L62 21.2"
          />
          <Path fill={part.headlight} d="M63 21.4 L67.3 22.4 L67.6 24.4 L62.6 23.6 Z" />
          <Path d={box(6, 21.8, 2.2, 4, 0.8)} fill={part.brakeLight} />
          <Path d={box(6, 29, 62, 3, 1.4)} fill={part.shadow} opacity={0.18} />
        </Svg>
      </Animated.View>
      <Wheel
        cx={19}
        cy={33}
        r={6.8}
        phase={phase}
        turns={turns}
        spokes={5}
        tire={tire}
        rim={rim}
        edge={mark}
      />
      <Wheel
        cx={53}
        cy={33}
        r={6.8}
        phase={phase}
        turns={turns}
        spokes={5}
        tire={tire}
        rim={rim}
        edge={mark}
      />
    </>
  );
}

/**
 * Fast (120 km/h and more, only shown with the sender's speed): a low race car and plain lines
 * streaming past. Nothing celebrates the speed (the PM): no sound, no confetti, no badge.
 */
function RaceCar({ phase, kmh, ink, mark, tire, rim, paint }: VehicleProps) {
  const turns = wheelTurns(kmh);
  return (
    <>
      <Passing
        y={42.2}
        period={12}
        dash={6}
        count={roadDashes(kmh)}
        thickness={1.3}
        color={mark}
        phase={phase}
      />
      {[17, 24, 30].map((y, index) => (
        <Streak
          key={y}
          y={y}
          length={8 + index * 3}
          from={6 - index * 3}
          travel={18}
          times={2}
          offset={index * 0.37}
          color={mark}
          phase={phase}
        />
      ))}
      <Svg style={styles.layer} width={72} height={44} viewBox="0 0 72 44">
        <Ellipse cx={38} cy={40.4} rx={31} ry={1.7} fill={part.shadow} opacity={0.2} />
        <Path d={box(3, 12.2, 12, 3.2, 1)} fill={ink} />
        <Path d={box(8.2, 15, 1.8, 10)} fill={ink} />
        <Path
          fill={paint}
          d="M7 30.5 L7 24 L15 21.6 L26 20.4 L29.5 16.6 Q33 13.4 37.4 14.6 L40.2 18.6 L46 19 L51 21 L62.5 25 L70.5 28.2 L70.5 30.2 L48 31.4 L25 31.4 Z"
        />
        <Path
          fill="none"
          stroke={part.shine}
          strokeWidth={1.3}
          strokeOpacity={0.85}
          d="M16 25.6 L46 24.4 L68 28.4"
        />
        <Circle cx={38.6} cy={16.6} r={3.3} fill={ink} />
        <Path fill="none" stroke={part.visor} strokeWidth={1.3} d="M38.6 15.4 L41.4 15.6" />
        <Path d={box(59, 30.6, 12.4, 2.2, 0.8)} fill={ink} />
      </Svg>
      <Wheel
        cx={17.5}
        cy={32.6}
        r={7.6}
        phase={phase}
        turns={turns}
        spokes={6}
        tire={tire}
        rim={rim}
        edge={mark}
      />
      <Wheel
        cx={55}
        cy={33.4}
        r={6.6}
        phase={phase}
        turns={turns}
        spokes={6}
        tire={tire}
        rim={rim}
        edge={mark}
      />
    </>
  );
}

/** A high-speed train (200–300 km/h): a long nose, its stripe in their colour, the track passing. */
function Train({ phase, ink, mark, glass, tire, rim, paint }: VehicleProps) {
  const sway = useBob(phase, 0.18);
  return (
    <>
      <Svg style={styles.layer} width={72} height={44} viewBox="0 0 72 44">
        <Line x1={-5} y1={39.6} x2={80} y2={39.6} stroke={mark} strokeWidth={1.2} />
      </Svg>
      <Passing
        y={41.4}
        period={6}
        dash={1.6}
        count={9}
        thickness={2.2}
        color={mark}
        phase={phase}
      />
      {[9, 30].map((y, index) => (
        <Streak
          key={y}
          y={y}
          length={6}
          from={76}
          travel={90}
          times={2}
          offset={index * 0.5}
          color={mark}
          phase={phase}
        />
      ))}
      <Animated.View style={[StyleSheet.absoluteFill, sway]}>
        <Svg width={72} height={44} viewBox="0 0 72 44">
          <Path fill="none" stroke={ink} strokeWidth={0.9} d="M20 13.5 L23.5 8.5 L29 8.5" />
          <Path
            fill={rim}
            d="M-4 13.6 L38 13.6 Q55 13.6 65 23 Q70.4 28 70.4 31 L70.4 33.6 L-4 33.6 Z"
          />
          <Path
            fill={part.shine}
            opacity={0.55}
            d="M-4 14.6 L38 14.6 Q54 14.6 63 22.6 L-4 22.6 Z"
          />
          <Path fill={paint} d="M-4 25.4 L66.6 25.4 Q69.4 27.4 70 29 L-4 29 Z" />
          <Path fill={glass} d="M46 15.6 Q56 16.6 61.6 22.2 L49.4 22.2 Z" />
          {[2, 11, 20, 29, 38].map((x) => (
            <Path key={x} d={box(x, 17.4, 6, 3.4, 1.2)} fill={glass} />
          ))}
          <Circle cx={67.6} cy={30.6} r={1} fill={part.headlight} />
          {[6, 14, 46, 54].map((x) => (
            <Circle key={x} cx={x} cy={35.4} r={2.4} fill={tire} stroke={mark} strokeWidth={0.6} />
          ))}
        </Svg>
      </Animated.View>
    </>
  );
}

/** A cloud passing behind the plane, `offset` of a cycle after the one before. */
function Cloud({
  phase,
  offset,
  y,
  width,
  color,
}: {
  phase: SharedValue<number>;
  offset: number;
  y: number;
  width: number;
  color: string;
}) {
  const move = useAnimatedStyle(() => ({
    transform: [{ translateX: -frac(phase.get() + offset) * 100 }],
  }));
  return (
    <Animated.View
      style={[
        styles.layer,
        { left: 84 - width / 2, top: y - 2.6, width, height: 5.2, borderRadius: 2.6 },
        { backgroundColor: color, opacity: 0.9 },
        move,
      ]}
    />
  );
}

/** A plane (300 km/h and more): nose a little up, its tail in their colour, clouds going by. */
function Plane({ phase, glass, paint, sky, cloud }: VehicleProps & { sky: string; cloud: string }) {
  const float = useBob(phase, 0.35);
  return (
    <>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: sky }]} />
      {[0, 1, 2].map((index) => (
        <Cloud
          key={index}
          phase={phase}
          offset={index / 3}
          y={9 + index * 13}
          width={14 + index * 4}
          color={cloud}
        />
      ))}
      <Animated.View style={[StyleSheet.absoluteFill, float]}>
        <Svg width={72} height={44} viewBox="0 0 72 44">
          <Line
            x1={-6}
            y1={26.8}
            x2={28}
            y2={27.6}
            stroke={part.shine}
            strokeWidth={1}
            opacity={0.7}
            strokeLinecap="round"
          />
          <Line
            x1={-6}
            y1={28.4}
            x2={28}
            y2={29.2}
            stroke={part.shine}
            strokeWidth={1}
            opacity={0.7}
            strokeLinecap="round"
          />
          <Path transform="rotate(-3 38 22)" fill={paint} d="M8 19 L3.6 8 L9.6 8 L18.4 19 Z" />
          <Path
            transform="rotate(-3 38 22)"
            fill={part.hull}
            d="M6 22.4 Q6 19 10.4 19 L56 19 Q66 19 69.6 22.8 Q66 26.4 57.6 26.4 L12 26.4 Q7.6 26.4 6 24.2 Z"
          />
          <Path
            transform="rotate(-3 38 22)"
            fill={paint}
            opacity={0.85}
            d="M10 24.2 L64 24.2 Q63 25.6 57.6 26.2 L12 26.2 Q9.4 26 10 24.2 Z"
          />
          <Ellipse
            transform="rotate(-3 38 22)"
            cx={12}
            cy={21.6}
            rx={5}
            ry={1.3}
            fill={part.tailplane}
          />
          <Path
            transform="rotate(-3 38 22)"
            fill={part.wing}
            d="M29 24.4 L21 32.6 L26.4 32.6 L42 24.4 Z"
          />
          <Ellipse
            transform="rotate(-3 38 22)"
            cx={31.6}
            cy={28.4}
            rx={4.6}
            ry={1.9}
            fill={part.engine}
          />
          {Array.from({ length: 14 }, (_, index) => (
            <Circle
              key={index}
              transform="rotate(-3 38 22)"
              cx={18 + index * 2.6}
              cy={21.2}
              r={0.62}
              fill={glass}
            />
          ))}
          <Path
            transform="rotate(-3 38 22)"
            fill={glass}
            d="M61.6 20.2 L65.6 20.6 L66.8 22 L62 22 Z"
          />
        </Svg>
      </Animated.View>
    </>
  );
}

/** A cyclist's leg on its pedal (`side` 1: the far one, half a turn on). */
function PedalLeg({
  phase,
  side,
  color,
}: {
  phase: SharedValue<number>;
  side: 0 | 1;
  color: string;
}) {
  const thigh = useAnimatedStyle(() => ({
    transform: [{ rotate: turn(pedalPose(phase.get(), side).thigh) }],
  }));
  const shin = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(pedalPose(phase.get(), side).knee)}deg` }],
  }));
  return (
    <View style={[StyleSheet.absoluteFill, { opacity: side === 1 ? FAR : 1 }]}>
      <Animated.View
        style={[bar(BIKE.hip.x, BIKE.hip.y, BIKE.thigh, 3.9), { backgroundColor: color }, thigh]}
      >
        <Animated.View
          style={[bar(1.95, BIKE.thigh - 1.6, BIKE.shin, 3.3), { backgroundColor: color }, shin]}
        />
      </Animated.View>
    </View>
  );
}

/** Someone cycling: the cranks go round, the legs follow the pedals, the wheels turn. */
function Bike({
  phase,
  kmh,
  ink,
  mark,
  tire,
  rim,
  paint,
  pants,
}: VehicleProps & { pants: string }) {
  const turns = wheelTurns(kmh);
  const crank = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(frac(phase.get()) * 360)}deg` }],
  }));
  const { x, y } = BIKE.crank;
  return (
    <>
      <Passing
        y={43}
        period={12}
        dash={6}
        count={roadDashes(kmh)}
        thickness={1.3}
        color={mark}
        phase={phase}
      />
      <Wheel
        cx={15}
        cy={33}
        r={8.6}
        phase={phase}
        turns={turns}
        spokes={8}
        tire={tire}
        rim={rim}
        edge={mark}
      />
      <Wheel
        cx={49}
        cy={33}
        r={8.6}
        phase={phase}
        turns={turns}
        spokes={8}
        tire={tire}
        rim={rim}
        edge={mark}
      />
      <PedalLeg phase={phase} side={1} color={pants} />
      <Svg style={styles.layer} width={72} height={44} viewBox="0 0 72 44">
        <Path
          fill="none"
          stroke={paint}
          strokeWidth={2.1}
          strokeLinecap="round"
          strokeLinejoin="round"
          d={`M15 33 L${String(x)} ${String(y)} L25 19.5 L42 18.6 L${String(x)} ${String(y)} M25 19.5 L15 33 M42 18.6 L43.6 24.4 L49 33`}
        />
        <Path
          fill="none"
          stroke={ink}
          strokeWidth={1.7}
          strokeLinecap="round"
          d="M21.4 18 L27.6 18 M42 18.6 L41 15.2 L45 14.6"
        />
        <Circle cx={x} cy={y} r={2.2} fill="none" stroke={ink} strokeWidth={1} />
        <Line
          x1={25.4}
          y1={15.6}
          x2={35.4}
          y2={9.4}
          stroke={paint}
          strokeWidth={6}
          strokeLinecap="round"
        />
        <Line
          x1={35.4}
          y1={9.4}
          x2={39.4}
          y2={12.8}
          stroke={paint}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <Line
          x1={39.4}
          y1={12.8}
          x2={43.6}
          y2={15}
          stroke={ink}
          strokeWidth={2.4}
          strokeLinecap="round"
        />
        <Circle cx={38.6} cy={5} r={3.7} fill={ink} />
        <Path fill={part.visor} d="M34.4 4.8 A4.3 4.3 0 0 1 42.6 3.8 Z" />
      </Svg>
      <Animated.View
        style={[
          bar(x, y - 4.6, 9.2, 1.6),
          { backgroundColor: ink, transformOrigin: '50% 50%' },
          crank,
        ]}
      />
      <PedalLeg phase={phase} side={0} color={pants} />
    </>
  );
}

/** In one place for a while: a little clock whose minute hand goes round. */
function Clock({ phase, color }: { phase: SharedValue<number>; color: string }) {
  const minute = useAnimatedStyle(() => ({
    transform: [{ rotate: `${String(phase.get() * 360)}deg` }],
  }));
  return (
    <View style={StyleSheet.absoluteFill}>
      <View style={[disc(14, 14, 19), { borderWidth: 1.6, borderColor: color }]} />
      {[0, 90, 180, 270].map((angle) => (
        <View
          key={angle}
          style={[
            disc(
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
      <View style={[disc(14, 14, 3), { backgroundColor: color }]} />
    </View>
  );
}

/**
 * A small drawn animation of what someone is doing, as the owner approved it (2026-10-21): a
 * walker, a runner, a cyclist, a car whose wheels and road go with the speed, a race car with plain
 * speed lines from 120 km/h, a high-speed train from 200 km/h, a plane from 300 km/h, or a clock
 * when they have stayed put. Driven by the pin's own cycle (sade mod decides how it plays, ADR
 * 0027); turned to face their direction. Fills `width` × `height`.
 */
export function ActivityGlyph({
  activity,
  phase,
  facing,
  speed,
  paint,
  width,
  height,
}: {
  activity: GlyphActivity;
  phase: SharedValue<number>;
  /** 1: facing east (right on the north-up map), -1: west. */
  facing: 1 | -1;
  /** m/s, when known: how fast wheels turn and the road passes. */
  speed?: number | null | undefined;
  /** Their own colour: the shirt, the car, the train's stripe, the plane's tail. */
  paint: string;
  width: number;
  height: number;
}) {
  const { colors, scheme } = useTheme();
  const drawn = drawingColors[scheme];
  const kmh = Math.round((speed ?? 0) * 3.6);
  const vehicle: VehicleProps = { phase, kmh, ink: colors.text, paint, ...drawn };
  let drawing: ReactNode;
  let grid = { width: PERSON_GRID, height: PERSON_GRID };
  switch (activity) {
    case 'walking':
    case 'running':
      drawing = (
        <Figure
          phase={phase}
          running={activity === 'running'}
          ink={colors.text}
          pants={colors.textMuted}
          shirt={paint}
        />
      );
      break;
    case 'cycling':
      grid = VEHICLE_GRID;
      drawing = <Bike {...vehicle} pants={colors.textMuted} />;
      break;
    case 'driving':
      grid = VEHICLE_GRID;
      drawing = <Car {...vehicle} />;
      break;
    case 'racing':
      grid = VEHICLE_GRID;
      drawing = <RaceCar {...vehicle} />;
      break;
    case 'train':
      grid = VEHICLE_GRID;
      drawing = <Train {...vehicle} />;
      break;
    case 'plane':
      grid = VEHICLE_GRID;
      drawing = <Plane {...vehicle} sky={drawn.sky} cloud={drawn.cloud} />;
      break;
    case 'settled':
      grid = { width: GLYPH, height: GLYPH };
      drawing = <Clock phase={phase} color={colors.text} />;
      break;
  }
  const scale = Math.min(width / grid.width, height / grid.height);
  return (
    <View
      testID={`activity-${activity}`}
      style={[
        { width, height, overflow: 'hidden' },
        activity === 'settled' ? null : { transform: [{ scaleX: facing }] },
      ]}
      pointerEvents="none"
    >
      <View
        style={{
          position: 'absolute',
          left: (width - grid.width * scale) / 2,
          top: (height - grid.height * scale) / 2,
          width: grid.width,
          height: grid.height,
          transformOrigin: [0, 0, 0],
          transform: [{ scale }],
        }}
      >
        {drawing}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { position: 'absolute', left: 0, top: 0 },
  person: { ...StyleSheet.absoluteFill },
  // Turns about the hip, so leaning keeps the legs where they are.
  upperBody: { ...StyleSheet.absoluteFill, transformOrigin: [FIGURE.hip.x, FIGURE.hip.y, 0] },
  foot: { position: 'absolute', left: 0.5, width: 4.2, height: 2.6, borderRadius: 1.3 },
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
