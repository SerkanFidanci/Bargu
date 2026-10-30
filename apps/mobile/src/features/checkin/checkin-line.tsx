import { ShieldCheck } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { space, useTheme } from '@/theme';
import { Text } from '@/ui/text';

import { clockOf } from '../location/person-share';
import type { ChatItem } from '../messages/messages';

/**
 * An arrival check's line in a conversation (docs/ADR/0039 §8): "Seni eve vardım kontrolüne ekledi ·
 * en geç 23:30", or "Vardı ✓". No place and no location: those are only in the sealed alert, and
 * only if it goes.
 */
export function CheckinLine({ item, ink }: { item: ChatItem; ink: 'text' | 'onBrand' }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const check = item.check;
  const words =
    item.kind === 'checkinOk'
      ? check?.late === true
        ? t('checkin.lines.okLate')
        : t('checkin.lines.ok')
      : check?.plan !== undefined
        ? t('checkin.lines.setPlan', { time: check.plan.at })
        : t('checkin.lines.set', {
            time:
              check?.due === undefined || check.due === null
                ? ''
                : clockOf(check.due, i18n.language),
          });
  return (
    <View style={styles.line} testID={`checkin-line-${item.id}`}>
      <ShieldCheck
        color={ink === 'text' ? colors.primary : colors.onBrand}
        size={18}
        strokeWidth={2.25}
      />
      <Text variant="body" color={ink} style={styles.words}>
        {words}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  words: { flexShrink: 1 },
});
