import { ExternalLink } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

const POINTS = ['what', 'why', 'encrypted', 'shared', 'rights'] as const;

/**
 * The KVKK information notice in short (docs/ADR/0022): what is processed, why, who receives it
 * and the user's rights, with the full text one tap away. Read and understood, not "accepted":
 * the main service rests on the contract, not on consent. The caller adds "Okudum, anladım".
 */
export function NoticeView() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <>
      <View style={[styles.card, { backgroundColor: colors.surface }]} testID="privacy-notice">
        {POINTS.map((point) => (
          <View key={point} style={styles.point}>
            <Text variant="bodyStrong">{t(`notice.${point}Title`)}</Text>
            <Text variant="callout" color="textMuted">
              {t(`notice.${point}`)}
            </Text>
          </View>
        ))}
      </View>
      <Button
        testID="notice-full"
        label={t('notice.full')}
        icon={ExternalLink}
        variant="secondary"
        onPress={() => void Linking.openURL(`${env.apiUrl}/gizlilik`)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg },
  point: { gap: space.xxs },
});
