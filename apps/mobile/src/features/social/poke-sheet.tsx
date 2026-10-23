import type { PokeStyle } from '@bargu/schemas';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';

/** What the sheet offers: a plain poke, then the feelings, then the questions (docs/ADR/0031). */
export type PokeChoice = 'bump' | Exclude<PokeStyle, 'reply'>;
export const POKE_CHOICES: readonly PokeChoice[] = [
  'bump',
  'kiss',
  'hug',
  'angry',
  'laugh',
  'excited',
  'where',
  'when',
  'answer',
];
export const POKE_EMOJI: Record<PokeChoice | 'reply', string> = {
  bump: '👉',
  kiss: '💋',
  hug: '🤗',
  angry: '😠',
  laugh: '😂',
  excited: '🤩',
  where: '📍',
  when: '⏰',
  answer: '💬',
  reply: '💬',
};

/**
 * "Dürt" on a person: nine ways at one tap each (the owner, 2026-10-23: "dürtmeleri geliştir,
 * çeşitli tarzlar gelsin").
 */
export const PokeSheet = forwardRef<
  SheetRef,
  { name: string | null; onChoose: (choice: PokeChoice) => void }
>(function PokeSheet({ name, onChoose }, ref) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <Sheet ref={ref} title={t('map.poke.title', { name: name ?? '' })} testID="poke-sheet">
      <View style={styles.grid}>
        {POKE_CHOICES.map((choice) => (
          <PressableScale
            key={choice}
            testID={`poke-${choice}`}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={t(`map.poke.styles.${choice}`)}
            onPress={() => {
              onChoose(choice);
            }}
            style={[styles.tile, { backgroundColor: colors.surface, borderColor: colors.border }]}
          >
            <Text variant="title2" allowFontScaling={false}>
              {POKE_EMOJI[choice]}
            </Text>
            <Text variant="footnote" align="center" numberOfLines={1} adjustsFontSizeToFit>
              {t(`map.poke.styles.${choice}`)}
            </Text>
          </PressableScale>
        ))}
      </View>
    </Sheet>
  );
});

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  tile: {
    // Three in a row: a third of the row, less the gaps.
    flexBasis: '30%',
    flexGrow: 1,
    minHeight: touchTarget * 2,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xs,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
