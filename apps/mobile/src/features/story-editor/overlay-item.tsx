import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { BOX_PAD, BOX_RADIUS } from './compose';
import { inkOn, type Overlay, SCALE_RANGE, STICKER_SIZE, TEXT_SIZE } from './edit-model';

type Place = Pick<Overlay, 'x' | 'y' | 'scale' | 'rotation'>;

/**
 * Words or a sticker on the photo, as Instagram has them: dragged with one finger, sized and turned
 * with two, all on the UI thread; where it ends is told once. Dropped on the bin (below `binY` on
 * screen) it goes; a tap on words opens them again.
 */
export function OverlayItem({
  overlay,
  maxWidth,
  binY,
  onMoving,
  onPlaced,
  onDropped,
  onEdit,
}: {
  overlay: Overlay;
  /** Words wrap here, as they will on the photo (compose.ts TEXT_WIDTH). */
  maxWidth: number;
  binY: number;
  onMoving: (moving: boolean) => void;
  onPlaced: (id: string, place: Place) => void;
  onDropped: (id: string) => void;
  onEdit: (id: string) => void;
}) {
  const x = useSharedValue(overlay.x);
  const y = useSharedValue(overlay.y);
  const scale = useSharedValue(overlay.scale);
  const rotation = useSharedValue(overlay.rotation);
  const width = useSharedValue(0);
  const height = useSharedValue(0);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startRotation = useSharedValue(0);
  const { id } = overlay;
  /** Where it is now, told once a gesture ends. */
  const commit = () => {
    'worklet';
    scheduleOnRN(onPlaced, id, {
      x: x.get(),
      y: y.get(),
      scale: scale.get(),
      rotation: rotation.get(),
    });
  };

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      startX.set(x.get());
      startY.set(y.get());
      scheduleOnRN(onMoving, true);
    })
    .onUpdate((event) => {
      x.set(startX.get() + event.translationX);
      y.set(startY.get() + event.translationY);
    })
    .onEnd((event) => {
      scheduleOnRN(onMoving, false);
      if (event.absoluteY >= binY) {
        scheduleOnRN(onDropped, id);
        return;
      }
      commit();
    });
  const pinch = Gesture.Pinch()
    .onStart(() => {
      startScale.set(scale.get());
    })
    .onUpdate((event) => {
      scale.set(
        Math.min(SCALE_RANGE.max, Math.max(SCALE_RANGE.min, startScale.get() * event.scale)),
      );
    })
    .onEnd(commit);
  const turn = Gesture.Rotation()
    .onStart(() => {
      startRotation.set(rotation.get());
    })
    .onUpdate((event) => {
      rotation.set(startRotation.get() + event.rotation);
    })
    .onEnd(commit);
  const tap = Gesture.Tap().onEnd(() => {
    if (overlay.kind === 'text') scheduleOnRN(onEdit, id);
  });
  const gesture = Gesture.Race(tap, Gesture.Simultaneous(pan, pinch, turn));

  const placed = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.get() - width.get() / 2 },
      { translateY: y.get() - height.get() / 2 },
      { rotate: `${String(rotation.get())}rad` },
      { scale: scale.get() },
    ],
  }));

  const sticker = overlay.kind === 'sticker';
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        testID={`overlay-${id}`}
        accessible
        accessibilityLabel={overlay.text}
        onLayout={(event) => {
          width.set(event.nativeEvent.layout.width);
          height.set(event.nativeEvent.layout.height);
        }}
        style={[styles.item, placed]}
      >
        <View
          style={
            overlay.boxed && !sticker
              ? [styles.box, { backgroundColor: overlay.color, maxWidth: maxWidth + BOX_PAD * 2 }]
              : { maxWidth }
          }
        >
          <Text
            allowFontScaling={false}
            style={[
              styles.words,
              {
                fontSize: sticker ? STICKER_SIZE : TEXT_SIZE,
                lineHeight: (sticker ? STICKER_SIZE : TEXT_SIZE) * 1.2,
                color: overlay.boxed ? inkOn(overlay.color) : overlay.color,
              },
            ]}
          >
            {overlay.text}
          </Text>
        </View>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  item: { position: 'absolute', left: 0, top: 0 },
  box: { padding: BOX_PAD, borderRadius: BOX_RADIUS },
  words: { fontWeight: '700', textAlign: 'center' },
});
