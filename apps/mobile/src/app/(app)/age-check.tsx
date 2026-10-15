import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { deleteAccount } from '@/features/account/account-api';
import type { AgeAnswer } from '@/features/account/age-answer';
import { ageKey, setAgeBand } from '@/features/account/age-api';
import { AgeQuestion } from '@/features/account/age-question';
import { runPrivacyGate } from '@/features/account/privacy-gate';
import { signOut } from '@/features/auth/auth-store';
import { errorMessage } from '@/features/errors';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * An account that never said its age band is asked once (docs/ADR/0023). Under 15 the account is
 * deleted, after a last word; closed without an answer, it is asked again at the next start.
 */
export default function AgeCheckScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [answer, setAnswer] = useState<AgeAnswer | null>(null);
  const [busy, setBusy] = useState(false);

  const removeAccount = () => {
    Alert.alert(t('age.under15Title'), t('age.under15Body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('age.under15Delete'),
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          void (async () => {
            try {
              await deleteAccount();
              toast.info(t('age.under15Deleted'));
              await signOut();
            } catch (error) {
              setBusy(false);
              toast.error(errorMessage(error, t));
            }
          })();
        },
      },
    ]);
  };

  const save = async () => {
    if (answer === null) return;
    if (answer === 'under15') {
      removeAccount();
      return;
    }
    setBusy(true);
    try {
      queryClient.setQueryData(ageKey, await setAgeBand(answer));
      toast.success(t('age.saved'));
      router.back();
      // The rest of what is asked after signing in (15-17 rules, the notice, consent).
      void runPrivacyGate(queryClient).catch(() => undefined);
    } catch (error) {
      setBusy(false);
      toast.error(errorMessage(error, t));
    }
  };

  return (
    <Screen title={t('age.checkTitle')} testID="age-check">
      <Text variant="callout" color="textMuted">
        {t('age.checkLead')}
      </Text>
      <AgeQuestion value={answer} onChange={setAnswer} />
      <Button
        testID="age-check-save"
        label={t('age.continue')}
        disabled={answer === null}
        loading={busy}
        onPress={() => void save()}
      />
    </Screen>
  );
}
