import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { privacyKey, readNotice } from '@/features/account/account-api';
import { NoticeView } from '@/features/account/notice-view';
import { checkHistoryConsent } from '@/features/account/privacy-gate';
import { errorMessage } from '@/features/errors';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** The information notice for an account that has not read this version yet (docs/ADR/0022). */
export default function AppNoticeScreen() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  return (
    <Screen title={t('notice.title')} testID="notice-screen">
      <Text variant="callout" color="textMuted">
        {t('notice.lead')}
      </Text>
      <NoticeView />
      <Button
        testID="notice-read"
        label={t('notice.read')}
        loading={busy}
        onPress={() => {
          setBusy(true);
          void readNotice().then(
            (state) => {
              queryClient.setQueryData(privacyKey, state);
              router.back();
              checkHistoryConsent(state);
            },
            (error: unknown) => {
              setBusy(false);
              toast.error(errorMessage(error, t));
            },
          );
        }}
      />
    </Screen>
  );
}
