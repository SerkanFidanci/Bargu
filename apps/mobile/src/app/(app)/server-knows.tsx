import { Eye, EyeOff, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { SERVER_CANNOT_SEE, SERVER_SEES } from '@/features/account/server-knows';
import { radius, space, useTheme } from '@/theme';
import { Hint } from '@/ui/hint';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

/**
 * "Sunucu ne biliyor?" (N2, the PM 2026-10-29), from "Hesap ve veri": what Bargu's server sees to
 * work, and what it cannot see because the phone encrypts it first. The same list as the accepted
 * leaks of docs/THREAT_MODEL.md, said plainly; nothing more promised than is so.
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
        items={SERVER_SEES.map((key) => ({ key, text: t(`serverKnows.sees.${key}`) }))}
      />
      <SectionTitle>{t('serverKnows.cannotTitle')}</SectionTitle>
      <List
        icon={EyeOff}
        items={SERVER_CANNOT_SEE.map((key) => ({ key, text: t(`serverKnows.cannot.${key}`) }))}
      />
      <Hint>{t('serverKnows.verify')}</Hint>
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
