import { PRIVACY_NOTICE_VERSION } from '@bargu/schemas';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useNoticeRead } from '@/features/account/account-api';
import { NoticeView } from '@/features/account/notice-view';
import { FormScreen } from '@/features/onboarding/form-screen';
import { Button } from '@/ui/button';

/**
 * The information notice before anything is processed (KVKK, docs/ADR/0022): read before the email
 * goes anywhere; sent to the account once signed in.
 */
export default function NoticeScreen() {
  const { t } = useTranslation();
  return (
    <FormScreen
      title={t('notice.title')}
      body={t('notice.lead')}
      footer={
        <Button
          testID="notice-read"
          label={t('notice.read')}
          onPress={() => {
            useNoticeRead.setState({ version: PRIVACY_NOTICE_VERSION });
            router.push('/email');
          }}
        />
      }
    >
      <NoticeView />
    </FormScreen>
  );
}
