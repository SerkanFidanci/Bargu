import { type LngLat, Marker } from '@maplibre/maplibre-react-native';
import { type ReactElement, useEffect, useRef, useState } from 'react';
import Animated, {
  Easing,
  ReduceMotion,
  useAnimatedProps,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { duration } from '@/theme';
import { useEffects } from '@/theme/effects';

import { type GlideFix, glideStep } from './glide';

/** MapLibre markers take their position from Reanimated on the UI thread (MapLibre RN v11). */
const AnimatedMarker = Animated.createAnimatedComponent(Marker);

export interface GlidingMarkerProps {
  id: string;
  /** A new object for each new location (the stored one, not rebuilt on render). */
  fix: GlideFix;
  onPress?: () => void;
  children: ReactElement;
}

/**
 * A person on the map who glides between locations instead of jumping (glide.ts), and stays put
 * when a location measured before the one shown arrives late. Only the start of each glide runs in
 * JavaScript, when a location arrives; the movement itself is a Reanimated timing on the UI thread. By sade mod (docs/ADR/0027): "reduced" makes each glide short, "off"
 * (and Reduce Motion, or the map not on screen) places the marker without moving it.
 */
export function GlidingMarker({ id, fix, onPress, children }: GlidingMarkerProps) {
  const lat = useSharedValue(fix.lat);
  const lng = useSharedValue(fix.lng);
  const previous = useRef<GlideFix | null>(null);
  // The first position only: afterwards Reanimated moves it (a changing prop would fight it).
  const [initial] = useState<LngLat>(() => [fix.lng, fix.lat]);
  // Read when a location arrives: a change of level alone starts no glide.
  const level = useEffects();
  const levelNow = useRef(level);
  useEffect(() => {
    levelNow.current = level;
  }, [level]);

  useEffect(() => {
    const step = glideStep({
      shown: { lat: lat.get(), lng: lng.get() },
      fix,
      previous: previous.current,
      now: Date.now(),
    });
    if (step === null) return;
    previous.current = fix;
    if (step.durationMs === 0 || levelNow.current === 'off') {
      lat.set(step.to.lat);
      lng.set(step.to.lng);
      return;
    }
    const short = levelNow.current === 'reduced';
    const config = {
      duration: short ? Math.min(step.durationMs, duration.slow) : step.durationMs,
      easing: step.linear && !short ? Easing.linear : Easing.out(Easing.cubic),
      reduceMotion: ReduceMotion.System,
    };
    lat.set(withTiming(step.to.lat, config));
    lng.set(withTiming(step.to.lng, config));
  }, [fix, lat, lng]);

  const animatedProps = useAnimatedProps<{ lngLat: LngLat }>(() => ({
    lngLat: [lng.get(), lat.get()],
  }));

  return (
    <AnimatedMarker
      id={id}
      lngLat={initial}
      anchor="center"
      animatedProps={animatedProps}
      {...(onPress === undefined ? {} : { onPress })}
    >
      {children}
    </AnimatedMarker>
  );
}
