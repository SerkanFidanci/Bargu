import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Download, ExternalLink, History, Trash2, UserRound } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Linking, StyleSheet, View } from 'react-native';

import { env } from '@/config/env';
import {
  deleteAccount,
  fetchAccountExport,
  fetchFindable,
  fetchPrivacy,
  findableKey,
  hasHistoryConsent,
  privacyKey,
  setFindable,
  setHistoryConsent,
} from '@/features/account/account-api';
import { billingApi } from '@/features/billing/billing-api';
import { ageKey, fetchAge, isMinor, setAgeBand } from '@/features/account/age-api';
import { exportFile, exportName, saveExport, trailWindow } from '@/features/account/export';
import { signOut, useAuth } from '@/features/auth/auth-store';
import { errorMessage } from '@/features/errors';
import { ownTrailForExport } from '@/features/history/own/own-session';
import { guardiansApi } from '@/features/guardians/guardians-api';
import {
  applyMinorRules,
  forgetAllHistory,
  history,
  updateSharing,
} from '@/features/location/location-session';
import { speedShown, useSharing } from '@/features/location/sharing';
import { usePlaces } from '@/features/places/places';
import { useDocs } from '@/features/plan/docs';
import { useMyStatus } from '@/features/social/status';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';
import { Toggle } from '@/ui/toggle';

/**
 * "Hesap ve veri" (docs/ADR/0022): the privacy notice, consent to location history and its
 * withdrawal, the age band (docs/ADR/0023), a copy of the account's data, and deleting the account.
 */
export default function PrivacyScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const me = useAuth((state) => state.userId);
  const privacy = useQuery({ queryKey: privacyKey, queryFn: fetchPrivacy });
  const age = useQuery({ queryKey: ageKey, queryFn: fetchAge });
  const findable = useQuery({ queryKey: findableKey, queryFn: fetchFindable });
  const changeFindable = (on: boolean) => {
    void (async () => {
      try {
        queryClient.setQueryData(findableKey, await setFindable(on));
      } catch (error) {
        toast.error(errorMessage(error, t));
      }
    })();
  };
  const band = age.data?.age?.band ?? null;
  const [busy, setBusy] = useState<'export' | 'withdraw' | 'delete' | 'age' | null>(null);
  const speed = useSharing(speedShown);
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

  /** 18+ to 15-17 is the user's own choice; back to 18+ takes a person (docs/ADR/0023). */
  const toTeen = () => {
    Alert.alert(t('age.toTeenTitle'), t('age.toTeenBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('age.toTeen'),
        style: 'destructive',
        onPress: () => {
          setBusy('age');
          void (async () => {
            try {
              queryClient.setQueryData(ageKey, await setAgeBand('15-17'));
              queryClient.setQueryData(findableKey, await fetchFindable());
              await applyMinorRules();
              // The server withdrew the consent to history along with it.
              queryClient.setQueryData(privacyKey, await fetchPrivacy());
              toast.success(t('age.saved'));
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
          ownTrail: await ownTrailForExport(),
          status: useMyStatus.getState().status,
        },
        now,
        (await fetchAge()).age,
        await guardiansApi.list(),
        await fetchFindable(),
        (await billingApi.records()).records,
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
          {isMinor(age.data)
            ? t('age.noHistory')
            : consent === true && consentGiven !== null
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

      <SectionTitle>{t('privacy.findableTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Toggle
          testID="privacy-findable"
          label={t('privacy.findable')}
          description={
            findable.data?.locked === true ? t('privacy.findableLocked') : t('privacy.findableHint')
          }
          value={findable.data?.findable ?? false}
          disabled={findable.data === undefined || findable.data.locked}
          onChange={changeFindable}
        />
      </View>

      <SectionTitle>{t('privacy.speedTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Toggle
          testID="privacy-speed"
          label={t('privacy.speed')}
          description={t('privacy.speedHint')}
          value={speed}
          onChange={(on) => {
            updateSharing((current) => ({ ...current, speed: on ? 'show' : 'hide' }));
          }}
        />
      </View>

      <SectionTitle>{t('age.sectionTitle')}</SectionTitle>
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="footnote" color="textMuted" testID="privacy-age">
          {band === null
            ? t('age.unknown')
            : t('age.current', { band: band === '18+' ? t('age.adult') : t('age.teen') })}
        </Text>
        {band === '18+' ? (
          <Button
            testID="privacy-age-teen"
            label={t('age.toTeen')}
            icon={UserRound}
            variant="secondary"
            loading={busy === 'age'}
            onPress={toTeen}
          />
        ) : null}
        {band === '15-17' ? (
          <Text variant="footnote" color="textMuted">
            {t('age.toAdultHint')}
          </Text>
        ) : null}
        {band === null && age.data !== undefined ? (
          <Button
            testID="privacy-age-tell"
            label={t('age.tell')}
            icon={UserRound}
            variant="secondary"
            onPress={() => {
              router.push('/age-check');
            }}
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
