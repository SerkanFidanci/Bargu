import type { Me } from '@bargu/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { HeartHandshake, KeyRound } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { DEV_TOOLS_ENABLED, env } from '@/config/env';
import {
  addPasskey,
  passkeyDiagnostic,
  passkeyFailure,
  passkeysSupported,
} from '@/features/auth/passkeys';
import { errorMessage } from '@/features/errors';
import { meKey, useMe } from '@/features/profile/queries';
import { vault } from '@/features/storage/vault';
import { setAppLock, useAppLock } from '@/features/security/app-lock';
import { SecurityEvents } from '@/features/security/security-events';
import { radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Screen, SectionTitle } from '@/ui/screen';
import { SettingsGroup, SettingsRow } from '@/ui/settings-row';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

/**
 * "Güvenlik" (Faz 9; from Me since the UX slice): passkeys and the guardian link, the app lock, what
 * to do when the phone is lost, and the account's security events.
 */
export default function SecurityScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const enabled = useAppLock((state) => state.enabled);
  const queryClient = useQueryClient();
  const passkeys = useMe().data?.passkeys ?? 0;
  const createPasskey = async () => {
    try {
      await addPasskey();
      // The count shown here comes from the cache: update it from the result, no refetch.
      queryClient.setQueryData<Me>(meKey, (current) =>
        current === undefined ? current : { ...current, passkeys: current.passkeys + 1 },
      );
      feedback('success');
      toast.success(t('sheets.me.passkeyAdded'));
    } catch (failure) {
      const detail = DEV_TOOLS_ENABLED ? ` (${passkeyDiagnostic(failure)})` : '';
      if (failure instanceof Error) {
        toast.error(errorMessage(failure, t) + detail);
        return;
      }
      const reason = passkeyFailure(failure);
      if (reason === 'exists') toast.info(t('sheets.me.passkeyExists'));
      else if (reason !== 'cancelled') toast.error(t('sheets.me.passkeyFailed') + detail);
    }
  };
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
      <SettingsGroup>
        {passkeysSupported() ? (
          <SettingsRow
            testID="security-passkey"
            icon={KeyRound}
            label={t('sheets.me.passkey')}
            detail={
              passkeys > 0
                ? t('sheets.me.passkeyCount', { count: passkeys })
                : t('sheets.me.passkeyAdd')
            }
            onPress={() => void createPasskey()}
          />
        ) : null}
        <SettingsRow
          testID="security-guardians"
          icon={HeartHandshake}
          label={t('sheets.me.guardians')}
          detail={t('sheets.me.guardiansDetail')}
          onPress={() => {
            router.push('/guardians');
          }}
        />
      </SettingsGroup>
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
