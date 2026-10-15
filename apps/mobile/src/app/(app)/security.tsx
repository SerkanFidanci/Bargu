import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import { vault } from '@/features/storage/vault';
import { setAppLock, useAppLock } from '@/features/security/app-lock';
import { SecurityEvents } from '@/features/security/security-events';
import { radius, space, useTheme } from '@/theme';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

/**
 * "Güvenlik" (Faz 9): the app lock, what to do when the phone is lost, and the account's security
 * events.
 */
export default function SecurityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const enabled = useAppLock((state) => state.enabled);
  // The account web page (docs/ADR/0021): from any browser, with a code sent to the email.
  const accountPage = `${env.apiUrl}/hesap`;

  const toggleLock = async (on: boolean) => {
    const result = await setAppLock(vault(), on, {
      prompt: on ? t('security.lock.promptOn') : t('security.lock.promptOff'),
      cancel: t('common.cancel'),
    });
    if (result === 'unavailable') toast.error(t('security.lock.unavailable'));
    else if (result === 'done') toast.success(on ? t('security.lock.on') : t('security.lock.off'));
  };

  return (
    <Screen title={t('security.title')} testID="security-screen">
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Toggle
          testID="app-lock"
          label={t('security.lock.toggle')}
          value={enabled}
          onChange={(on) => {
            void toggleLock(on);
          }}
        />
        <Text variant="footnote" color="textMuted">
          {t('security.lock.hint')}
        </Text>
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]} testID="lost-phone">
        <Text variant="bodyStrong">{t('security.lost.title')}</Text>
        <Text variant="footnote" color="textMuted">
          {t('security.lost.body')}
        </Text>
        <Text variant="callout" selectable>
          {accountPage}
        </Text>
      </View>

      <SectionTitle>{t('security.events')}</SectionTitle>
      <SecurityEvents />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
});
