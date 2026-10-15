import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import type { AgeAnswer } from './age-answer';

const ANSWERS: readonly { answer: AgeAnswer; label: 'age.adult' | 'age.teen' | 'age.under' }[] = [
  { answer: '18+', label: 'age.adult' },
  { answer: '15-17', label: 'age.teen' },
  { answer: 'under15', label: 'age.under' },
];

/**
 * "Kaç yaşındasın?" (docs/ADR/0023): three answers, none chosen in advance. Only the band is kept,
 * never a birth date.
 */
export function AgeQuestion({
  value,
  onChange,
}: {
  value: AgeAnswer | null;
  onChange: (answer: AgeAnswer) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.list} accessibilityRole="radiogroup">
      {ANSWERS.map(({ answer, label }) => {
        const on = value === answer;
        return (
          <PressableScale
            key={answer}
            testID={`age-${answer}`}
            haptic="select"
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t(label)}
            onPress={() => {
              onChange(answer);
            }}
            style={[
              styles.option,
              {
                backgroundColor: on ? colors.primarySoft : colors.surface,
                borderColor: on ? colors.primary : colors.border,
              },
            ]}
          >
            <Text variant="bodyStrong" style={styles.label}>
              {t(label)}
            </Text>
            {on ? <Check size={20} color={colors.primary} strokeWidth={3} /> : null}
          </PressableScale>
        );
      })}
      {value === '15-17' ? (
        <Text variant="footnote" color="textMuted">
          {t('age.teenHint')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  option: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.lg,
    borderWidth: 2,
  },
  label: { flex: 1 },
});
