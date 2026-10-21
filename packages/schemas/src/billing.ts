import { z } from 'zod';

import { COSMETIC_PRODUCTS } from './cosmetics.js';

/**
 * Bargu+ and what an account has (docs/ADR/0024): per account, with where it came from. Only the
 * account itself ever sees its plan; others see only whether a circle is open.
 */
export const PLUS_PRODUCTS = ['plus_month', 'plus_year'] as const;
export const ENTITLEMENT_SOURCES = ['bargu', 'test', 'play', 'appstore'] as const;
export type PlusProduct = (typeof PLUS_PRODUCTS)[number];

/** A cosmetic pack's product id (`cosmetic:<pack>`). */
/** A pack that exists (docs/ADR/0025 §4): an unknown one cannot be bought, nor signed. */
export const cosmeticProductSchema = z.enum(COSMETIC_PRODUCTS);

/**
 * The account's plan now. `trial` and `plus` keep the circles it is in open; `free` does not.
 * Read leniently: a field a newer server adds is dropped.
 */
export const planSchema = z.object({
  plan: z.enum(['free', 'trial', 'plus']),
  /** The plan running now, if any. */
  product: z.enum(['trial', ...PLUS_PRODUCTS]).nullable(),
  source: z.enum(ENTITLEMENT_SOURCES).nullable(),
  /** When it runs out (Unix ms), unless renewed. */
  expiresAt: z.number().int().nullable(),
  autoRenew: z.boolean(),
  /** A payment failed: the plan holds until then (Unix ms). */
  graceUntil: z.number().int().nullable(),
  /** The trial's end, past or to come (Unix ms); null without one. */
  trialEndsAt: z.number().int().nullable(),
  /** Cosmetic packs bought, for good. */
  cosmetics: z.array(z.string()),
  /** Test purchases work on this server (staging, never production). */
  testBilling: z.boolean(),
  /** 15-17: the plan asked of a parent, waiting for their yes (docs/ADR/0024 §5). */
  pendingPurchase: z.enum(PLUS_PRODUCTS).nullable().optional(),
  /**
   * 15-17: the packs (`rings`, as in `cosmetics`) asked of a parent, waiting for their yes (docs/ADR/0025
   * §6). Apart from `pendingPurchase`: a pack and Bargu+ are asked and answered separately.
   */
  pendingCosmetics: z.array(z.string()).optional(),
});
export type Plan = z.infer<typeof planSchema>;

/**
 * Every plan and pack the account ever had, for "Verilerimi indir" (KVKK, docs/ADR/0022): its own
 * route, so the export apps already know stays as it is. Read leniently.
 */
export const planRecordsSchema = z.object({
  records: z.array(
    z.object({
      product: z.string(),
      source: z.enum(ENTITLEMENT_SOURCES),
      state: z.enum(['active', 'grace', 'canceled', 'expired', 'refunded']),
      startsAt: z.number().int(),
      expiresAt: z.number().int().nullable(),
      graceUntil: z.number().int().nullable(),
      autoRenew: z.boolean(),
    }),
  ),
});
export type PlanRecords = z.infer<typeof planRecordsSchema>;

/** A test purchase (only where test billing is on; docs/ADR/0024 §6). */
export const testPurchaseSchema = z
  .object({ product: z.union([z.enum(PLUS_PRODUCTS), cosmeticProductSchema]) })
  .strict();
export type TestPurchase = z.infer<typeof testPurchaseSchema>;

/** What a store would do to the caller's test plan, or to its trial (`endTrial`). */
export const TEST_ACTIONS = [
  'renew',
  'cancel',
  'expire',
  'fail',
  'recover',
  'refund',
  'endTrial',
] as const;
export const testSimulateSchema = z.object({ action: z.enum(TEST_ACTIONS) }).strict();
export type TestSimulate = z.infer<typeof testSimulateSchema>;
