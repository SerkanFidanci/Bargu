import type { ReactNode } from 'react';
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { press, spring } from '@/theme';
import { feedback } from '@/theme/haptics';
import type { HapticKind } from '@/theme/motion';

export interface PressableScaleProps extends Omit<PressableProps, 'style' | 'children'> {
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
  /** Haptic played on press (none by default). */
  haptic?: HapticKind | undefined;
}

/**
 * A pressable that shrinks slightly while held. The scale runs on the UI thread (Reanimated);
 * with Reduce Motion the spring settles instantly, so only the dimming remains.
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
  const animated = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.get() * (1 - press.scale) }],
    opacity: 1 - pressed.get() * (1 - press.opacity),
  }));

  return (
    <Pressable
      {...props}
      disabled={disabled}
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
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  );
}
