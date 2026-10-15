import type { ReactNode } from 'react';
import {
  Pressable,
  type PressableProps,
  type StyleProp,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { press, spring } from '@/theme';
import { feedback } from '@/theme/haptics';
import type { HapticKind } from '@/theme/motion';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** Haptic played on press (none by default). */
  haptic?: HapticKind | undefined;
}

/**
 * A pressable that shrinks slightly while held. The scale runs on the UI thread (Reanimated);
 * with Reduce Motion the spring settles instantly, so only the dimming remains. Its style is the
 * pressable's own, so layout works as on any view (`flex: 1` in a row, `alignSelf`), and a
 * style's own opacity (a disabled control) is kept, the press dimming on top of it.
 */
export function PressableScale({
  style,
  children,
  haptic,
  onPressIn,
  onPressOut,
  onPress,
  disabled,
  ...props
}: PressableScaleProps) {
  const pressed = useSharedValue(0);
  // An array always flattens to an object, even with no style at all (QA 3a-B3).
  const flat = StyleSheet.flatten([style]);
  const base = typeof flat.opacity === 'number' ? flat.opacity : 1;
  const animated = useAnimatedStyle(
    () => ({
      transform: [{ scale: 1 - pressed.get() * (1 - press.scale) }],
      opacity: base * (1 - pressed.get() * (1 - press.opacity)),
    }),
    [base],
  );

  return (
    <AnimatedPressable
      {...props}
      disabled={disabled}
      style={[style, animated]}
      onPressIn={(event) => {
        pressed.set(withSpring(1, spring.snappy));
        onPressIn?.(event);
      }}
      onPressOut={(event) => {
        // A slightly bouncy release makes presses feel alive (settles instantly with Reduce Motion).
        pressed.set(withSpring(0, spring.bouncy));
        onPressOut?.(event);
      }}
      onPress={(event) => {
        if (haptic !== undefined) feedback(haptic);
        onPress?.(event);
      }}
    >
      {children}
    </AnimatedPressable>
  );
}
