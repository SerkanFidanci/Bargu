import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, ExternalLink, History, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import {
  deleteAccount,
  fetchAccountExport,
  fetchPrivacy,
  hasHistoryConsent,
  privacyKey,
  setHistoryConsent,
} from '@/features/account/account-api';
import { exportFile, exportName, saveExport, trailWindow } from '@/features/account/export';
import { signOut, useAuth } from '@/features/auth/auth-store';
import { errorMessage } from '@/features/errors';
import { forgetAllHistory, history } from '@/features/location/location-session';
import { useSharing } from '@/features/location/sharing';
import { usePlaces } from '@/features/places/places';
import { useDocs } from '@/features/plan/docs';
import { useMyStatus } from '@/features/social/status';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * "Gizlilik ve hesap" (docs/ADR/0022): the privacy notice, consent to location history and its
 * withdrawal, a copy of the account's data, and deleting the account.
 */
export default function PrivacyScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.userId);
  const privacy = useQuery({ queryKey: privacyKey, queryFn: fetchPrivacy });
  const [busy, setBusy] = useState<'export' | 'withdraw' | 'delete' | null>(null);
  const consent = privacy.data === undefined ? null : hasHistoryConsent(privacy.data);
  const noticeRead = privacy.data?.notice ?? null;
  const consentGiven = privacy.data?.history ?? null;

  const withdraw = () => {
    Alert.alert(t('privacy.withdrawTitle'), t('privacy.withdrawBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('privacy.withdraw'),
        style: 'destructive',
        onPress: () => {
          setBusy('withdraw');
          void (async () => {
            try {
              await forgetAllHistory();
              queryClient.setQueryData(privacyKey, await setHistoryConsent(false));
              toast.success(t('privacy.withdrawn'));
            } catch (error) {
              toast.error(errorMessage(error, t));
            } finally {
              setBusy(null);
            }
          })();
        },
      },
    ]);
  };

  const download = async () => {
    if (me === null) return;
    setBusy('export');
    try {
      const now = Date.now();
      const { from, to } = trailWindow(now);
      const file = exportFile(
        await fetchAccountExport(),
        {
          sharing: useSharing.getState(),
          places: Object.values(usePlaces.getState()),
          docs: Object.values(useDocs.getState()),
          myTrail: history.mine(from, to),
          status: useMyStatus.getState().status,
        },
        now,
      );
      const saved = await saveExport(exportName(now), JSON.stringify(file, null, 2));
      if (saved) toast.success(t('privacy.exported'));
    } catch (error) {
      toast.error(errorMessage(error, t));
    } finally {
      setBusy(null);
    }
  };

  const remove = () => {
    Alert.alert(t('privacy.deleteTitle'), t('privacy.deleteBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('privacy.deleteContinue'),
        style: 'destructive',
        onPress: () => {
          // Asked twice: it cannot be undone.
          Alert.alert(t('privacy.deleteSureTitle'), t('privacy.deleteSureBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('privacy.delete'),
              style: 'destructive',
              onPress: () => {
                setBusy('delete');
                void (async () => {
                  try {
                    await deleteAccount();
                    toast.success(t('privacy.deleted'));
                    await signOut();
                  } catch (error) {
                    setBusy(null);
                    toast.error(errorMessage(error, t));
                  }
                })();
              },
            },
          ]);
        },
      },
    ]);
  };

  return (
    <Screen title={t('privacy.title')} testID="privacy-screen">
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="bodyStrong">{t('privacy.noticeTitle')}</Text>
        <Text variant="footnote" color="textMuted">
          {noticeRead === null
            ? t('privacy.noticeBody')
            : t('privacy.noticeRead', {
                date: new Date(noticeRead.at).toLocaleDateString(i18n.language),
              })}
        </Text>
        <Button
          testID="privacy-policy"
          label={t('privacy.policy')}
          icon={ExternalLink}
          variant="secondary"
          onPress={() => void Linking.openURL(`${env.apiUrl}/gizlilik`)}
        />
      </View>

      <SectionTitle>{t('privacy.consentTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="footnote" color="textMuted">
          {consent === true && consentGiven !== null
            ? t('privacy.consentGiven', {
                date: new Date(consentGiven.at).toLocaleDateString(i18n.language),
              })
            : t('privacy.consentNone')}
        </Text>
        {consent === true ? (
          <Button
            testID="privacy-withdraw"
            label={t('privacy.withdraw')}
            icon={History}
            variant="secondary"
            loading={busy === 'withdraw'}
            onPress={withdraw}
          />
        ) : null}
      </View>

      <SectionTitle>{t('privacy.dataTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="footnote" color="textMuted">
          {t('privacy.exportBody')}
        </Text>
        <Button
          testID="privacy-export"
          label={t('privacy.export')}
          icon={Download}
          variant="secondary"
          loading={busy === 'export'}
          onPress={() => void download()}
        />
      </View>

      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="bodyStrong">{t('privacy.deleteTitle')}</Text>
        <Text variant="footnote" color="textMuted">
          {t('privacy.deleteHint')}
        </Text>
        <Button
          testID="privacy-delete"
          label={t('privacy.delete')}
          icon={Trash2}
          variant="danger"
          loading={busy === 'delete'}
          onPress={remove}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
});
