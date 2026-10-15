import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type AgeAnswer, useAgeAnswer } from '@/features/account/age-answer';
import { AgeQuestion } from '@/features/account/age-question';
import { FormScreen } from '@/features/onboarding/form-screen';
import { Button } from '@/ui/button';

/**
 * Before the email (docs/ADR/0023): the age band a new account opens with. Under 15 no account is
 * opened and nothing goes to the server.
 */
export default function AgeScreen() {
  const { t } = useTranslation();
  const [answer, setAnswer] = useState<AgeAnswer | null>(() => useAgeAnswer.getState().answer);
  return (
    <FormScreen
      title={t('age.title')}
      body={t('age.lead')}
      footer={
        <Button
          testID="age-continue"
          label={t('age.continue')}
          disabled={answer === null}
          onPress={() => {
            if (answer === null) return;
            useAgeAnswer.setState({ answer });
            router.push(answer === 'under15' ? '/too-young' : '/email');
          }}
        />
      }
    >
      <AgeQuestion value={answer} onChange={setAnswer} />
    </FormScreen>
  );
}
