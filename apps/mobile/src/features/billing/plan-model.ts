import type { Plan, PlusProduct } from '@bargu/schemas';

const DAY_MS = 24 * 60 * 60_000;
/** The trial reminder comes this long before it ends (docs/ADR/0024 §4). */
export const TRIAL_REMINDER_MS = 3 * DAY_MS;

/**
 * Bargu+ prices in lira (BARGU_PLAN Faz 9B, PM 2026-10-16; estimates, not validated). A store
 * gives its own, localised, once it is connected; test purchases show these.
 */
export const PLUS_PRICES: Record<PlusProduct, number> = { plus_month: 99.99, plus_year: 799.99 };

/** How much the yearly plan saves against twelve months, as a whole percentage. */
export function yearlySaving(prices: Record<PlusProduct, number> = PLUS_PRICES): number {
  return Math.round((1 - prices.plus_year / (prices.plus_month * 12)) * 100);
}

/** A price as the user reads it ("₺99,99"). */
export function priceText(amount: number, language: string): string {
  return new Intl.NumberFormat(language === 'tr' ? 'tr-TR' : 'en-GB', {
    style: 'currency',
    currency: 'TRY',
  }).format(amount);
}

/** When to remind that the trial ends: three days before, if that is still to come. */
export function trialReminderAt(plan: Plan, now: number): number | null {
  if (plan.plan !== 'trial' || plan.trialEndsAt === null) return null;
  const at = plan.trialEndsAt - TRIAL_REMINDER_MS;
  return at > now ? at : null;
}

/** The trial ends within three days: the app says so (and the plan screen offers Bargu+). */
export function trialEndingSoon(plan: Plan, now: number): boolean {
  return (
    plan.plan === 'trial' &&
    plan.trialEndsAt !== null &&
    plan.trialEndsAt > now &&
    plan.trialEndsAt - now <= TRIAL_REMINDER_MS
  );
}

/** Days left (rounded up) until a moment, for "3 gün kaldı". */
export function daysLeft(until: number, now: number): number {
  return Math.max(0, Math.ceil((until - now) / DAY_MS));
}
