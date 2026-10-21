import { PRIVACY_NOTICE_VERSION, type PrivacyState } from '@bargu/schemas';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useEffect } from 'react';

import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import {
  applyAdultDefaults,
  applyMinorRules,
  loadSharingSettings,
} from '../location/location-session';
import {
  fetchPrivacy,
  hasHistoryConsent,
  needsNotice,
  privacyKey,
  readNotice,
  useNoticeRead,
} from './account-api';
import { answeredBand } from './age-answer';
import { ageKey, fetchAge, isMinor, setAgeBand } from './age-api';

type QueryClient = ReturnType<typeof useQueryClient>;

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
 * Once signed in, in order:
 * 1. The age band (docs/ADR/0023): an account that never said it gives the answer from before
 *    signing in, or is asked; 15-17 gets its rules on this phone.
 * 2. The notice read before signing in goes to the account; one that has not read this version
 *    sees it (docs/ADR/0022).
 * 3. Consent to history if it is on without one.
 * Offline, the next start tries again. The age screen runs it again once answered.
 */
export async function runPrivacyGate(
  queryClient: QueryClient,
  run: { cancelled: boolean } = { cancelled: false },
): Promise<void> {
  let age = await queryClient.query({ queryKey: ageKey, queryFn: fetchAge });
  if (age.age === null) {
    const band = answeredBand();
    if (band === undefined) {
      if (!run.cancelled) router.push('/age-check');
      return;
    }
    age = await setAgeBand(band);
    queryClient.setQueryData(ageKey, age);
  }
  if (isMinor(age)) await applyMinorRules();
  // 18+: background live mode starts on (docs/ADR/0028 step 3); a teen's phone has it off.
  else applyAdultDefaults();

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
  if (!run.cancelled && !isMinor(age)) checkHistoryConsent(state);
}

export function usePrivacyGate(ready: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) return;
    const run = { cancelled: false };
    void runPrivacyGate(queryClient, run).catch(() => undefined);
    return () => {
      run.cancelled = true;
    };
  }, [ready, queryClient]);
}

/**
 * Before turning history on for a circle: true when the account already consented; otherwise the
 * consent screen opens (and turns it on itself once given). 15-17 gets no history at all
 * (docs/ADR/0023).
 */
export async function ensureHistoryConsent(
  queryClient: QueryClient,
  circleId: string,
): Promise<boolean> {
  const age = await queryClient.query({ queryKey: ageKey, queryFn: fetchAge });
  if (isMinor(age)) {
    toast.info(i18n.t('age.noHistory'));
    return false;
  }
  const state = await queryClient.query({ queryKey: privacyKey, queryFn: fetchPrivacy });
  if (hasHistoryConsent(state)) return true;
  router.push({ pathname: '/consent', params: { circle: circleId } });
  return false;
}
