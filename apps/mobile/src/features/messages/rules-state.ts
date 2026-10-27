import { COMMUNITY_RULES_VERSION, type RulesState, rulesStateSchema } from '@bargu/schemas';

import { api } from '../auth/auth-store';
import { queryClient } from '../query-client';

/**
 * Whether the community rules were accepted (K14; rules.tsx shows them): read from the server once,
 * kept in the query cache, forgotten when the server says otherwise.
 */

export const rulesKey = ['rules'] as const;

export const rulesApi = {
  async get(): Promise<RulesState> {
    return rulesStateSchema.parse(await api.authed('/v1/me/rules'));
  },
  async accept(): Promise<RulesState> {
    return rulesStateSchema.parse(
      await api.authed('/v1/me/rules', {
        method: 'PUT',
        body: { version: COMMUNITY_RULES_VERSION },
      }),
    );
  },
};

/** Whether the rules of this version (or a later one) were accepted. */
export function rulesAccepted(state: RulesState | undefined): boolean {
  return (state?.rules?.version ?? 0) >= COMMUNITY_RULES_VERSION;
}

/** The server said they were not accepted (an older record, another phone): ask again. */
export function forgetRules(): void {
  queryClient.setQueryData<RulesState>(rulesKey, { rules: null });
}
