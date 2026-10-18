import { Info } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';

import { Text } from './text';

/** A short explanation under a control, led by an ⓘ (the theme of 2026-10-18). */
export function Hint({ children, testID }: { children: string; testID?: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.hint} testID={testID}>
      <Info color={colors.textMuted} size={16} strokeWidth={2} />
      <Text variant="footnote" color="textMuted" style={styles.text}>
        {children}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  text: { flex: 1 },
});
