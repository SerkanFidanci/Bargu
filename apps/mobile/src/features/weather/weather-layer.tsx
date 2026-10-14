import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
  Points,
  RadialGradient,
  Rect,
  Skia,
  type SkPoint,
  useClock,
} from '@shopify/react-native-skia';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import { useDerivedValue, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { weatherFx } from '@/theme';

import { useMapScheme } from '../map/appearance';
import type { WeatherHere } from './weather';

/** Effect colours over the light and the dark map (rain, snow, fog and cloud, sun, flash). */
const PALETTE = {
  light: {
    rain: 'rgba(52, 92, 150, 0.42)',
    snow: 'rgba(255, 255, 255, 0.95)',
    mist: 'rgba(235, 238, 242, 1)',
    sun: 'rgba(255, 196, 64, 1)',
    star: 'rgba(255, 255, 255, 0.9)',
    flash: 'rgba(255, 255, 255, 1)',
  },
  dark: {
    rain: 'rgba(190, 215, 255, 0.36)',
    snow: 'rgba(255, 255, 255, 0.9)',
    mist: 'rgba(160, 168, 180, 1)',
    sun: 'rgba(255, 196, 64, 1)',
    star: 'rgba(255, 255, 255, 0.85)',
    flash: 'rgba(220, 230, 255, 1)',
  },
} as const;
type Palette = (typeof PALETTE)[keyof typeof PALETTE];

/** A fixed number in [0, 1) per particle, so each keeps its own path (no randomness needed). */
function seed(n: number): number {
  'worklet';
  const x = Math.sin(n * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

interface Area {
  width: number;
  height: number;
}

/** Rain or drizzle: streaks falling at a slant that grows with the wind. */
function Rain({
  area,
  count,
  fallMs,
  length,
  tilt,
  color,
}: {
  area: Area;
  count: number;
  fallMs: number;
  length: number;
  tilt: number;
  color: string;
}) {
  const clock = useClock();
  const { width, height } = area;
  const path = useDerivedValue(() => {
    const t = clock.get();
    const p = Skia.Path.Make();
    for (let i = 0; i < count; i++) {
      const speed = 0.8 + 0.4 * seed(i + 0.7);
      const progress = (t / fallMs) * speed + seed(i);
      const y = (progress % 1) * (height + length) - length;
      const x = seed(i + 0.3) * (width + height * tilt) - y * tilt;
      p.moveTo(x, y);
      p.lineTo(x - length * tilt, y + length);
    }
    return p;
  });
  return <Path path={path} style="stroke" strokeWidth={1.4} strokeCap="round" color={color} />;
}

/** Snow: flakes drifting down and swaying. */
function Snow({ area, count, color }: { area: Area; count: number; color: string }) {
  const clock = useClock();
  const { width, height } = area;
  const { fallMs, sway, size } = weatherFx.snow;
  const points = useDerivedValue(() => {
    const t = clock.get();
    const result: SkPoint[] = [];
    for (let i = 0; i < count; i++) {
      const speed = 0.7 + 0.6 * seed(i + 0.7);
      const y = (((t / fallMs) * speed + seed(i)) % 1) * (height + size * 4) - size * 2;
      const x = seed(i + 0.3) * width + Math.sin(t / 1_000 + i) * sway * seed(i + 0.9);
      result.push({ x, y });
    }
    return result;
  });
  return (
    <Points points={points} mode="points" strokeWidth={size * 2} strokeCap="round" color={color} />
  );
}

/** Fog or clouds: large soft shapes drifting slowly across. */
function Drift({
  area,
  count,
  driftMs,
  opacity,
  color,
  low,
}: {
  area: Area;
  count: number;
  driftMs: number;
  opacity: number;
  color: string;
  /** Fog lies low and wide; clouds float higher and rounder. */
  low: boolean;
}) {
  const clock = useClock();
  const { width, height } = area;
  const radius = (low ? 0.5 : 0.3) * width;
  const shift = useDerivedValue(() => ((clock.get() / driftMs) % 1) * (width + radius * 2));
  return (
    <Group opacity={opacity}>
      {Array.from({ length: count }, (_, i) => (
        <Puff
          key={i}
          shift={shift}
          x={seed(i + 0.1) * width}
          y={(low ? 0.35 + 0.5 * seed(i + 0.2) : 0.1 + 0.6 * seed(i + 0.2)) * height}
          radius={radius * (0.7 + 0.5 * seed(i + 0.4))}
          span={width + radius * 2}
          color={color}
        />
      ))}
    </Group>
  );
}

function Puff({
  shift,
  x,
  y,
  radius,
  span,
  color,
}: {
  shift: { get(): number };
  x: number;
  y: number;
  radius: number;
  span: number;
  color: string;
}) {
  const cx = useDerivedValue(() => ((x + shift.get()) % span) - radius);
  return (
    <Circle cx={cx} cy={y} r={radius} color={color}>
      <BlurMask blur={radius / 2} style="normal" />
    </Circle>
  );
}

/** A clear day: a soft warm glow in the corner, slowly breathing. */
function Sun({ area, top, color }: { area: Area; top: number; color: string }) {
  const clock = useClock();
  const { pulseMs, opacity } = weatherFx.sun;
  const glow = useDerivedValue(
    () => opacity * (0.75 + 0.25 * Math.sin((clock.get() / pulseMs) * 2 * Math.PI)),
  );
  const r = area.width * 0.55;
  const c = { x: area.width, y: top };
  return (
    <Group opacity={glow}>
      <Rect x={0} y={0} width={area.width} height={area.height}>
        <RadialGradient c={c} r={r} colors={[color, 'transparent']} />
      </Rect>
    </Group>
  );
}

/** A clear night: a few stars twinkling. */
function Stars({ area, color }: { area: Area; color: string }) {
  const clock = useClock();
  const { count, twinkleMs } = weatherFx.stars;
  const stars = Array.from({ length: count }, (_, i) => ({
    x: seed(i + 0.11) * area.width,
    y: seed(i + 0.57) * area.height * 0.6,
  }));
  const twinkle = useDerivedValue(
    () => 0.35 + 0.35 * (1 + Math.sin((clock.get() / twinkleMs) * 2 * Math.PI)) * 0.5,
  );
  return (
    <Group opacity={twinkle}>
      <Points points={stars} mode="points" strokeWidth={2.5} strokeCap="round" color={color} />
    </Group>
  );
}

/** A storm: a short flash of lightning now and then. */
function Lightning({ area, color }: { area: Area; color: string }) {
  const clock = useClock();
  const { everyMs, ms, opacity } = weatherFx.flash;
  const flash = useDerivedValue(() => {
    const cycle = Math.floor(clock.get() / everyMs);
    // Not every cycle, and not at the same moment: it should not feel like a metronome.
    const at = clock.get() % everyMs;
    const offset = seed(cycle) * (everyMs - ms * 2);
    return seed(cycle + 0.5) > 0.35 && at > offset && at < offset + ms ? opacity : 0;
  });
  return (
    <Group opacity={flash}>
      <Rect x={0} y={0} width={area.width} height={area.height} color={color} />
    </Group>
  );
}

function Effects({
  here,
  area,
  top,
  palette,
}: {
  here: WeatherHere;
  area: Area;
  top: number;
  palette: Palette;
}) {
  const windTilt = Math.min(here.wind / 60, 0.4);
  switch (here.kind) {
    case 'storm':
      return (
        <>
          <Drift
            area={area}
            count={weatherFx.clouds.puffs}
            driftMs={weatherFx.clouds.driftMs / 2}
            opacity={weatherFx.clouds.opacity * 2}
            color={palette.mist}
            low={false}
          />
          <Rain
            area={area}
            count={weatherFx.rain.drops}
            fallMs={weatherFx.rain.fallMs}
            length={weatherFx.rain.length}
            tilt={weatherFx.rain.tilt + windTilt}
            color={palette.rain}
          />
          <Lightning area={area} color={palette.flash} />
        </>
      );
    case 'rain':
    case 'drizzle': {
      const fx = here.kind === 'rain' ? weatherFx.rain : weatherFx.drizzle;
      return (
        <Rain
          area={area}
          count={Math.round(fx.drops * here.intensity)}
          fallMs={fx.fallMs}
          length={fx.length}
          tilt={fx.tilt + windTilt}
          color={palette.rain}
        />
      );
    }
    case 'snow':
      return (
        <Snow
          area={area}
          count={Math.round(weatherFx.snow.flakes * here.intensity)}
          color={palette.snow}
        />
      );
    case 'fog':
      return (
        <Drift
          area={area}
          count={weatherFx.fog.bands}
          driftMs={weatherFx.fog.driftMs}
          opacity={weatherFx.fog.opacity}
          color={palette.mist}
          low
        />
      );
    case 'clouds':
      return (
        <Drift
          area={area}
          count={weatherFx.clouds.puffs}
          driftMs={weatherFx.clouds.driftMs}
          opacity={weatherFx.clouds.opacity * here.intensity}
          color={palette.mist}
          low={false}
        />
      );
    case 'clear':
      return here.day ? (
        <Sun area={area} top={top} color={palette.sun} />
      ) : (
        <Stars area={area} color={palette.star} />
      );
  }
}

/**
 * The weather where the user is, drawn over the map (BARGU_PLAN §4.3 ambient states): rain,
 * drizzle, snow, fog, clouds, a storm's lightning, the sun by day and stars at night. One Skia
 * canvas, every frame computed on the UI thread; it never takes a touch. Off with Reduce Motion.
 */
export function WeatherLayer({ here }: { here: WeatherHere }) {
  const reduced = useReducedMotion();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scheme = useMapScheme();
  if (reduced) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Canvas style={StyleSheet.absoluteFill}>
        <Effects here={here} area={{ width, height }} top={insets.top} palette={PALETTE[scheme]} />
      </Canvas>
    </View>
  );
}
