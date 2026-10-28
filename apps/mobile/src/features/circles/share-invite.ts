import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share } from 'react-native';

import { toast } from '@/ui/toast';

import { errorMessage } from '../errors';
import { circlesApi } from './circles-api';

/**
 * A one-time friend link handed to the phone's share sheet: from the add sheet, the empty map and
 * the empty messages (the PM report T7, 2026-10-29). Whoever opens it still has to say yes.
 */
export function useShareInvite(): { sharing: boolean; share: () => Promise<void> } {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);
  const share = async () => {
    setSharing(true);
    try {
      const invite = await circlesApi.createInvite({ kind: 'friend' });
      await Share.share({ message: t('add.shareMessage', { link: invite.link }) });
    } catch (error) {
      toast.error(errorMessage(error, t));
    } finally {
      setSharing(false);
    }
  };
  return { sharing, share };
}
