import type { Plan } from '@bargu/schemas';

const DAY_MS = 24 * 60 * 60_000;
/** The trial reminder comes this long before it ends (docs/ADR/0024 §4). */
export const TRIAL_REMINDER_MS = 3 * DAY_MS;

// Bargu+ prices are the store's own, localised (store-prices.ts): none is written here (QA-42).

/** A price as the user reads it ("₺99,99"). */
export function priceText(amount: number, language: string): string {
  return new Intl.NumberFormat(language === 'tr' ? 'tr-TR' : 'en-GB', {
    style: 'currency',
    currency: 'TRY',
  }).format(amount);
}

/** A yearly plan's renewal is told this long before (N3, the PM 2026-10-29). */
export const RENEWAL_REMINDER_MS = 3 * DAY_MS;

/**
 * When to remind that a yearly plan renews: three days before, while it renews and that is still
 * to come (N3: no renewal a user did not see coming). A month needs none: the store tells.
 */
export function renewalReminderAt(plan: Plan, now: number): number | null {
  if (plan.plan !== 'plus' || plan.product !== 'plus_year') return null;
  if (!plan.autoRenew || plan.expiresAt === null) return null;
  const at = plan.expiresAt - RENEWAL_REMINDER_MS;
  return at > now ? at : null;
}

/**
 * Where the store manages the subscription, one tap away (N3): Google Play's page for it, or the
 * App Store's subscriptions. None for one that is not the store's (a test, Bargu's own trial).
 */
export function manageUrl(plan: Plan, androidPackage: string): string | null {
  if (plan.plan !== 'plus' || plan.product === null || plan.product === 'trial') return null;
  if (plan.source === 'play') {
    return `https://play.google.com/store/account/subscriptions?sku=${plan.product}&package=${androidPackage}`;
  }
  if (plan.source === 'appstore') return 'https://apps.apple.com/account/subscriptions';
  return null;
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
