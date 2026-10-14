import { type LngLat } from '@maplibre/maplibre-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { space, spring, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';

import { PLACE_RADII } from './place-model';

/** The size handle: big enough for a thumb. */
const HANDLE = space.xl + space.xs;

/** Metres per screen point on the map (place-model.ts metersPerPoint), as a worklet. */
function metersPerPoint(zoom: number, lat: number): number {
  'worklet';
  return (40_075_016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

/** The offered size nearest to a dragged radius (place-model.ts snapRadius), as a worklet. */
function snap(meters: number): number {
  'worklet';
  let best: number = PLACE_RADII[0];
  for (const radius of PLACE_RADII) {
    if (Math.abs(radius - meters) < Math.abs(best - meters)) best = radius;
  }
  return best;
}

/** The camera as the editor needs it, updated from map events (no re-render while panning). */
export interface EditorView {
  zoom: SharedValue<number>;
  lat: SharedValue<number>;
}

export function useEditorView(start: { zoom: number; lat: number }) {
  const zoom = useSharedValue(start.zoom);
  const lat = useSharedValue(start.lat);
  const view: EditorView = { zoom, lat };
  const onViewChange = (next: { center: LngLat; zoom: number }) => {
    zoom.set(next.zoom);
    lat.set(next.center[1]);
  };
  return { view, onViewChange };
}

/**
 * The place's circle over the centre of the map (BARGU_PLAN §4.3: "haritada daireyi parmakla
 * sürükle/büyüt"): moving the map moves the place under it; the handle on its edge resizes it,
 * snapping to 100 / 250 / 500 m with a tick each time it passes to another size. All on the UI
 * thread; only the chosen size goes back to the screen.
 */
export function PlaceCircle({
  view,
  radius,
  onRadius,
}: {
  view: EditorView;
  radius: number;
  onRadius: (radius: number) => void;
}) {
  const { colors } = useTheme();
  const meters = useSharedValue(radius);
  const dragging = useSharedValue(false);
  const startPx = useSharedValue(0);
  const chosen = useSharedValue(radius);

  useEffect(() => {
    if (!dragging.get()) meters.set(withSpring(radius, spring.snappy));
    chosen.set(radius);
  }, [chosen, dragging, meters, radius]);

  const choose = (next: number) => {
    feedback('select');
    onRadius(next);
  };

  const pan = Gesture.Pan()
    .onBegin(() => {
      dragging.set(true);
      startPx.set(meters.get() / metersPerPoint(view.zoom.get(), view.lat.get()));
    })
    .onUpdate((event) => {
      const px = Math.max(space.xl, startPx.get() + event.translationX);
      const next = px * metersPerPoint(view.zoom.get(), view.lat.get());
      meters.set(next);
      const snapped = snap(next);
      if (snapped !== chosen.get()) {
        chosen.set(snapped);
        scheduleOnRN(choose, snapped);
      }
    })
    .onFinalize(() => {
      dragging.set(false);
      meters.set(withSpring(chosen.get(), spring.snappy));
    });

  const ring = useAnimatedStyle(() => {
    const px = meters.get() / metersPerPoint(view.zoom.get(), view.lat.get());
    return { width: px * 2, height: px * 2, borderRadius: px };
  });
  const handle = useAnimatedStyle(() => ({
    transform: [
      { translateX: meters.get() / metersPerPoint(view.zoom.get(), view.lat.get()) - HANDLE / 2 },
    ],
  }));

  return (
    <View pointerEvents="box-none" style={styles.center}>
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ring,
          { borderColor: colors.primary, backgroundColor: `${colors.primary}22` },
          ring,
        ]}
      />
      <View pointerEvents="none" style={[styles.dot, { backgroundColor: colors.primary }]} />
      <GestureDetector gesture={pan}>
        <Animated.View
          accessibilityRole="adjustable"
          style={[
            styles.handle,
            { backgroundColor: colors.surfaceRaised, borderColor: colors.primary },
            handle,
          ]}
        />
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 2 },
  dot: { position: 'absolute', width: space.sm, height: space.sm, borderRadius: space.xs },
  handle: {
    position: 'absolute',
    left: '50%',
    width: HANDLE,
    height: HANDLE,
    borderRadius: HANDLE / 2,
    borderWidth: 3,
  },
});
