import { planSchema } from '@bargu/schemas';

import { api } from '../auth/auth-store';
import { type TestBilling, useTestBilling } from './test-slot';

/**
 * The calls of test billing (apps/api billing, docs/ADR/0024), loaded only by development and
 * preview builds (index.ts, behind EXPO_PUBLIC_TEST_BILLING). They work only where the server has
 * test billing on. A production bundle does not contain this file, so it holds neither the code nor
 * the paths of these two routes.
 */
const testBilling: TestBilling = {
  /** A purchase with no payment (a plan, or a cosmetic pack). */
  async purchase(product) {
    return planSchema.parse(
      await api.authed('/v1/billing/test/purchase', { method: 'POST', body: { product } }),
    );
  },
  /** What a store would do to this account's test plan, or to its trial. */
  async simulate(action) {
    return planSchema.parse(
      await api.authed('/v1/billing/test/simulate', { method: 'POST', body: { action } }),
    );
  },
};

useTestBilling.setState({ api: testBilling });
