import { useQuery } from '@tanstack/react-query';

import { useAuth } from '../auth/auth-store';
import { billingApi } from './billing-api';

/** The account's plan in the query cache; refreshed on the server's `plan.changed` (no polling). */
export const planKey = ['plan'] as const;

export function usePlan() {
  const signedIn = useAuth((state) => state.status === 'signedIn');
  return useQuery({ queryKey: planKey, queryFn: () => billingApi.plan(), enabled: signedIn });
}
