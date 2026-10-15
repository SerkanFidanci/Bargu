import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/features/onboarding/form-screen';
import { Button } from '@/ui/button';

/** Under 15 (docs/ADR/0023): no account, nothing sent; going back lets a wrong tap be fixed. */
export default function TooYoungScreen() {
  const { t } = useTranslation();
  return (
    <FormScreen
      title={t('age.tooYoungTitle')}
      body={t('age.tooYoungBody')}
      footer={
        <Button
          testID="too-young-back"
          label={t('age.back')}
          variant="secondary"
          onPress={() => {
            router.back();
          }}
        />
      }
    >
      {null}
    </FormScreen>
  );
}
