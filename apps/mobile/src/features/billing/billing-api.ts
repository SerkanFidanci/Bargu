import {
  type Plan,
  type PlanRecords,
  planRecordsSchema,
  planSchema,
  type TestPurchase,
  type TestSimulate,
} from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** Thin, validated calls for the account's plan and test purchases (apps/api billing, ADR 0024). */
export const billingApi = {
  async plan(): Promise<Plan> {
    return planSchema.parse(await api.authed('/v1/me/plan'));
  },
  /** Every plan and pack the account ever had, for "Verilerimi indir". */
  async records(): Promise<PlanRecords> {
    return planRecordsSchema.parse(await api.authed('/v1/me/plan/records'));
  },
  /** A purchase with no payment: only where the server has test billing on (preview builds). */
  async testPurchase(product: TestPurchase['product']): Promise<Plan> {
    return planSchema.parse(
      await api.authed('/v1/billing/test/purchase', { method: 'POST', body: { product } }),
    );
  },
  /** What a store would do to this account's test plan, or to its trial. */
  async simulate(action: TestSimulate['action']): Promise<Plan> {
    return planSchema.parse(
      await api.authed('/v1/billing/test/simulate', { method: 'POST', body: { action } }),
    );
  },
};
