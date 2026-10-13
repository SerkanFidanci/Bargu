import type { LucideIcon } from 'lucide-react-native';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ambient, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';

import { Button } from './button';
import { Text } from './text';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}

/** What a list or sheet shows when there is nothing yet, with the one next step. */
export function EmptyState({ icon: Icon, title, body, action }: EmptyStateProps) {
  const { colors } = useTheme();
  const motion = useMotion();
  const reduced = useReducedMotion();
  const bob = useSharedValue(0);

  useEffect(() => {
    if (reduced) return;
    bob.set(
      withRepeat(
        withTiming(1, { duration: ambient.float.duration, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(bob);
    };
  }, [bob, reduced]);

  const floating = useAnimatedStyle(() => ({
    transform: [{ translateY: -bob.get() * ambient.float.distance }],
  }));

  return (
    <View style={styles.container}>
      {/* Entering and floating on separate views: both animate the transform. */}
      <Animated.View entering={motion.pop}>
        <Animated.View style={[styles.icon, { backgroundColor: colors.primarySoft }, floating]}>
          <Icon color={colors.primary} size={28} strokeWidth={2} />
        </Animated.View>
      </Animated.View>
      <Text variant="title2" align="center" accessibilityRole="header">
        {title}
      </Text>
      {body === undefined ? null : (
        <Text variant="callout" color="textMuted" align="center">
          {body}
        </Text>
      )}
      {action === undefined ? null : (
        <View style={styles.action}>
          <Button label={action.label} onPress={action.onPress} fill={false} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: space.md, padding: space.xl },
  icon: {
    width: 64,
    height: 64,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: space.xs,
  },
  action: { marginTop: space.sm },
});
