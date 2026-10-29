import { ExternalLink, Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import { SERVER_CANNOT_SEE, SERVER_SEES_KEYS } from '@/features/account/server-knows';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Hint } from '@/ui/hint';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

/**
 * "Sunucu ne biliyor?" (N2, the PM 2026-10-29; QA-42), from "Hesap ve veri": what Bargu's server
 * sees to work, in groups, each resting on an accepted leak of docs/THREAT_MODEL.md, and what it
 * cannot see because the phone encrypts it first. The full list is the privacy policy, one tap away.
 */
export default function ServerKnowsScreen() {
  const { t } = useTranslation();
  return (
    <Screen title={t('serverKnows.title')} testID="server-knows-screen">
      <Text variant="callout" color="textMuted">
        {t('serverKnows.intro')}
      </Text>
      <SectionTitle>{t('serverKnows.seesTitle')}</SectionTitle>
      <List
        icon={Eye}
        items={SERVER_SEES_KEYS.map((key) => ({ key, text: t(`serverKnows.sees.${key}`) }))}
      />
      <SectionTitle>{t('serverKnows.cannotTitle')}</SectionTitle>
      <List
        icon={EyeOff}
        items={SERVER_CANNOT_SEE.map((key) => ({ key, text: t(`serverKnows.cannot.${key}`) }))}
      />
      <Hint>{t('serverKnows.verify')}</Hint>
      <Button
        testID="server-knows-policy"
        label={t('serverKnows.full')}
        icon={ExternalLink}
        variant="secondary"
        onPress={() => void Linking.openURL(`${env.apiUrl}/gizlilik`)}
      />
    </Screen>
  );
}

function List({ icon: Icon, items }: { icon: LucideIcon; items: { key: string; text: string }[] }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: colors.surface }]}>
      {items.map((item) => (
        <View key={item.key} style={styles.row} testID={`server-knows-${item.key}`}>
          <Icon color={colors.primary} size={18} strokeWidth={2.25} />
          <Text variant="body" style={styles.text}>
            {item.text}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, padding: space.lg, borderRadius: radius.lg },
  row: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  text: { flex: 1 },
});
