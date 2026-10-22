import type { Plan, TestPurchase, TestSimulate } from '@bargu/schemas';
import { create } from 'zustand';

/** What a test build can do to its own plan: buy with no payment, and play what a store would do. */
export interface TestBilling {
  purchase(product: TestPurchase['product']): Promise<Plan>;
  simulate(action: TestSimulate['action']): Promise<Plan>;
}

/**
 * Test billing exists only in development and preview builds (EXPO_PUBLIC_TEST_BILLING, index.ts
 * loads features/billing/test-billing.ts behind it). A production bundle does not contain its code
 * or its server paths, so there this stays empty, no screen offers a test purchase and none can be
 * made, whatever the server says (apps/mobile/scripts/check-bundle.mjs checks that).
 */
export const useTestBilling = create<{ api: TestBilling | null }>(() => ({ api: null }));

/** The test billing a build has; a screen only calls this after it showed a test purchase. */
export function testBillingOf(billing: TestBilling | null): TestBilling {
  if (billing === null) throw new Error('this build has no test billing');
  return billing;
}
