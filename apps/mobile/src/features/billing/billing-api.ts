import { type Plan, type PlanRecords, planRecordsSchema, planSchema } from '@bargu/schemas';

import { api } from '../auth/auth-store';

/**
 * Thin, validated calls for the account's plan (apps/api billing, ADR 0024). The test purchase
 * calls are not here: they live in test-billing.ts, which only development and preview builds load.
 */
export const billingApi = {
  async plan(): Promise<Plan> {
    return planSchema.parse(await api.authed('/v1/me/plan'));
  },
  /** Every plan and pack the account ever had, for "Verilerimi indir". */
  async records(): Promise<PlanRecords> {
    return planRecordsSchema.parse(await api.authed('/v1/me/plan/records'));
  },
};
