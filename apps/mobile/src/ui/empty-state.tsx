import type { LucideIcon } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';

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
  return (
    <View style={styles.container}>
      <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
        <Icon color={colors.primary} size={28} strokeWidth={2} />
      </View>
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
