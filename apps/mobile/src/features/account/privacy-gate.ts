import { PRIVACY_NOTICE_VERSION, type PrivacyState } from '@bargu/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';

import { loadSharingSettings } from '../location/location-session';
import {
  fetchPrivacy,
  hasHistoryConsent,
  needsNotice,
  privacyKey,
  readNotice,
  useNoticeRead,
} from './account-api';

/**
 * Location history is on somewhere but the account never consented to it (it was on before the
 * app asked): ask once; saying no turns it off and deletes it (docs/ADR/0022).
 */
export function checkHistoryConsent(state: PrivacyState): void {
  const on = Object.values(loadSharingSettings().circles).some(
    (sharing) => sharing.history === true,
  );
  if (on && !hasHistoryConsent(state)) {
    router.push({ pathname: '/consent', params: { review: '1' } });
  }
}

/**
 * Once signed in: the notice read before signing in goes to the account; an account that has not
 * read this version sees it; then consent to history if it is on without one. Offline, the next
 * start tries again.
 */
export function usePrivacyGate(ready: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    const run = { cancelled: false };
    void (async () => {
      let state = await queryClient.query({ queryKey: privacyKey, queryFn: fetchPrivacy });
      if (needsNotice(state)) {
        const read = useNoticeRead.getState().version;
        if (read === null || read < PRIVACY_NOTICE_VERSION) {
          if (!run.cancelled) router.push('/notice');
          return;
        }
        state = await readNotice();
        queryClient.setQueryData(privacyKey, state);
      }
      if (!run.cancelled) checkHistoryConsent(state);
    })().catch(() => undefined);
    return () => {
      run.cancelled = true;
    };
  }, [ready, queryClient]);
}

/**
 * Before turning history on for a circle: true when the account already consented; otherwise the
 * consent screen opens (and turns it on itself once given).
 */
export async function ensureHistoryConsent(
  queryClient: ReturnType<typeof useQueryClient>,
  circleId: string,
): Promise<boolean> {
  const state = await queryClient.query({ queryKey: privacyKey, queryFn: fetchPrivacy });
  if (hasHistoryConsent(state)) return true;
  router.push({ pathname: '/consent', params: { circle: circleId } });
  return false;
}
