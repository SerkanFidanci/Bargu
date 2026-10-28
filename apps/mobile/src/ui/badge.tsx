import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { type ColorName, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';

import { Text } from './text';

type BadgeTone = 'muted' | 'primary' | 'success' | 'danger';

const TONES: Record<BadgeTone, { background: ColorName; text: ColorName }> = {
  muted: { background: 'surface', text: 'textMuted' },
  primary: { background: 'primarySoft', text: 'primary' },
  success: { background: 'surface', text: 'success' },
  danger: { background: 'surface', text: 'danger' },
};

export interface BadgeProps {
  label: string;
  tone?: BadgeTone;
  icon?: LucideIcon;
}

/** A small status chip ("Owner", "Waiting", "Verified"); pops in when it appears or changes. */
export function Badge({ label, tone = 'muted', icon: Icon }: BadgeProps) {
  const { colors } = useTheme();
  const motion = useMotion();
  const look = TONES[tone];
  return (
    <Animated.View key={label} entering={motion.pop}>
      <View style={[styles.badge, { backgroundColor: colors[look.background] }]}>
        {Icon === undefined ? null : <Icon color={colors[look.text]} size={14} strokeWidth={2.5} />}
        <Text variant="caption" color={look.text} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
  },
});
