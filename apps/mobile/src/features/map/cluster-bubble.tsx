import type { Avatar as AvatarData } from '@bargu/schemas';
import { Blur, Canvas, Circle, ColorMatrix, Group, Paint } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { avatarSize, space, spring, useTheme } from '@/theme';
import { AvatarStack } from '@/ui/avatar-stack';
import { Text } from '@/ui/text';

/** The canvas around the merged bubble: room for members flowing in from where they were. */
const BOX = avatarSize.md * 4;
const CENTER = BOX / 2;
const BLOB = avatarSize.md / 2 + space.xs;
/** Blobs drawn (more members merge into these). */
const MAX_BLOBS = 4;
/** "Goo": blur the blobs, then cut the blurred alpha sharply so touching shapes become one. */
const GOO_BLUR = space.md;
const GOO_MATRIX = [1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 24, -9];

export interface ClusterPerson {
  id: string;
  name: string;
  avatar: AvatarData | null;
}

function Blob({
  from,
  to,
  merge,
  color,
}: {
  from: { x: number; y: number };
  to: { x: number; y: number };
  merge: SharedValue<number>;
  color: string;
}) {
  const cx = useDerivedValue(() => CENTER + from.x + (to.x - from.x) * merge.get());
  const cy = useDerivedValue(() => CENTER + from.y + (to.y - from.y) * merge.get());
  return <Circle cx={cx} cy={cy} r={BLOB} color={color} />;
}

/**
 * Several people too close to tell apart at this zoom (BARGU_PLAN §4.3 metaball clustering): their
 * bubbles flow together like liquid into one (Skia "goo" on the UI thread) showing their avatars
 * and how many they are. Tapping it zooms in so they separate again.
 */
export function ClusterBubble({
  people,
  offsets,
  onPress,
}: {
  people: readonly ClusterPerson[];
  /** Where each member was on screen relative to the centre (px). */
  offsets: readonly { x: number; y: number }[];
  onPress: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const merge = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    merge.set(withSpring(1, spring.gentle));
  }, [merge]);

  const shown = people.slice(0, MAX_BLOBS);
  // Settled, the blobs sit in a short row behind the avatar stack.
  const finalOffset = (index: number) => ({
    x: (index - (shown.length - 1) / 2) * (BLOB * 0.6),
    y: 0,
  });
  const labels = useAnimatedStyle(() => ({ opacity: merge.get() }));

  return (
    <View style={styles.box} pointerEvents="box-none">
      <Canvas style={StyleSheet.absoluteFill} pointerEvents="none">
        <Group
          layer={
            <Paint>
              <Blur blur={GOO_BLUR} />
              <ColorMatrix matrix={GOO_MATRIX} />
            </Paint>
          }
        >
          {shown.map((person, index) => (
            <Blob
              key={person.id}
              from={offsets[index] ?? { x: 0, y: 0 }}
              to={finalOffset(index)}
              merge={merge}
              color={colors.surfaceRaised}
            />
          ))}
        </Group>
      </Canvas>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={t('map.cluster', {
          count: people.length,
          names: people.map((person) => person.name).join(', '),
        })}
        style={styles.center}
      >
        <Animated.View style={[styles.content, labels]}>
          <AvatarStack people={people} max={3} size="sm" />
          <View style={[styles.count, { backgroundColor: colors.primary }]}>
            <Text variant="caption" allowFontScaling={false} style={{ color: colors.onPrimary }}>
              {String(people.length)}
            </Text>
          </View>
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: BOX, height: BOX, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', justifyContent: 'center' },
  content: { flexDirection: 'row', alignItems: 'center', gap: space.xxs },
  count: {
    minWidth: space.lg + space.xs,
    paddingHorizontal: space.xs,
    borderRadius: space.md,
    alignItems: 'center',
  },
});
