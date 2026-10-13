import { Check, X } from 'lucide-react-native';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { radius, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';

import type { UsernameCheck } from './queries';

const SIZE = 24;

/**
 * Live status at the end of the username field: a spinner while checking, then a check mark or a
 * cross that pops in. Decorative: the same status is read out from the text under the field.
 */
export function UsernameStatus({ check }: { check: UsernameCheck }) {
  const { colors } = useTheme();
  const motion = useMotion();

  let content = null;
  let key = 'none';
  if (check.state === 'checking' || check.state === 'unknown') {
    key = 'checking';
    content = <ActivityIndicator size="small" color={colors.textMuted} />;
  } else if (check.state === 'done' && check.result.available) {
    key = 'available';
    content = (
      <View style={[styles.badge, { backgroundColor: colors.success }]}>
        <Check color={colors.onSuccess} size={16} strokeWidth={3} />
      </View>
    );
  } else if (check.state === 'done') {
    key = 'unavailable';
    content = (
      <View style={[styles.badge, { backgroundColor: colors.danger }]}>
        <X color={colors.onDanger} size={16} strokeWidth={3} />
      </View>
    );
  }

  return (
    <View
      style={styles.slot}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
    >
      {content === null ? null : (
        <Animated.View key={key} entering={motion.pop} exiting={motion.fadeOut}>
          {content}
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' },
  badge: {
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
