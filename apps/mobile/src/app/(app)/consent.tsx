import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { privacyKey, setHistoryConsent } from '@/features/account/account-api';
import { errorMessage } from '@/features/errors';
import { forgetAllHistory, setHistory } from '@/features/location/location-session';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * Explicit consent to location history (KVKK, docs/ADR/0022): its own screen and its own words,
 * apart from the information notice; nothing ticked in advance. Asked when history is first
 * turned on for a circle (`circle`), or once for those who had it on before the app asked
 * (`review`): saying no there turns it off and deletes it, and so does closing it without an
 * answer (no consent given; QA Faz 9 slice 4, K4), so it is not asked at every start.
 */
export default function HistoryConsentScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ circle?: string; review?: string }>();
  const review = params.review === '1';
  const [busy, setBusy] = useState<'give' | 'decline' | null>(null);
  const navigation = useNavigation();
  const answered = useRef(false);

  const turnOff = useCallback(async () => {
    const result = await forgetAllHistory();
    toast.info(
      result === 'later' ? t('location.sharing.historyOffLater') : t('consent.declinedOff'),
    );
  }, [t]);

  useEffect(() => {
    if (!review) return;
    return navigation.addListener('beforeRemove', () => {
      if (answered.current) return;
      answered.current = true;
      void turnOff();
    });
  }, [navigation, review, turnOff]);

  const give = async () => {
    setBusy('give');
    try {
      queryClient.setQueryData(privacyKey, await setHistoryConsent(true));
      if (params.circle !== undefined) await setHistory(params.circle, true);
      answered.current = true;
      toast.success(t('consent.given'));
      router.back();
    } catch (error) {
      toast.error(errorMessage(error, t));
      setBusy(null);
    }
  };

  const decline = async () => {
    if (!review) {
      router.back();
      return;
    }
    answered.current = true;
    setBusy('decline');
    await turnOff();
    router.back();
  };

  return (
    <Screen title={t('consent.title')} testID="history-consent">
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        {review ? <Text variant="callout">{t('consent.review')}</Text> : null}
        <Text variant="bodyStrong">{t('consent.whatTitle')}</Text>
        <Text variant="callout" color="textMuted">
          {t('consent.what')}
        </Text>
        <Text variant="bodyStrong">{t('consent.whoTitle')}</Text>
        <Text variant="callout" color="textMuted">
          {t('consent.who')}
        </Text>
        <Text variant="bodyStrong">{t('consent.howLongTitle')}</Text>
        <Text variant="callout" color="textMuted">
          {t('consent.howLong')}
        </Text>
        <Text variant="bodyStrong">{t('consent.withdrawTitle')}</Text>
        <Text variant="callout" color="textMuted">
          {t('consent.withdraw')}
        </Text>
        <Text variant="footnote" color="textMuted">
          {t('consent.statement')}
        </Text>
      </View>
      <Button
        testID="consent-give"
        label={t('consent.give')}
        loading={busy === 'give'}
        onPress={() => void give()}
      />
      <Button
        testID="consent-decline"
        label={review ? t('consent.declineReview') : t('consent.decline')}
        variant="secondary"
        loading={busy === 'decline'}
        onPress={() => void decline()}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
});
