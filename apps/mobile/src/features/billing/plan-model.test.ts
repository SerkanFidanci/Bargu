import type { Plan } from '@bargu/schemas';

import {
  daysLeft,
  manageUrl,
  priceText,
  RENEWAL_REMINDER_MS,
  renewalReminderAt,
  TRIAL_REMINDER_MS,
  trialEndingSoon,
  trialReminderAt,
} from './plan-model';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60_000;
const trial = (endsIn: number): Plan => ({
  plan: 'trial',
  product: 'trial',
  source: 'bargu',
  expiresAt: NOW + endsIn,
  autoRenew: false,
  graceUntil: null,
  trialEndsAt: NOW + endsIn,
  cosmetics: [],
  testBilling: true,
});

describe('the plan as the app shows it (docs/ADR/0024)', () => {
  it('reminds three days before the trial ends, not after', () => {
    expect(trialReminderAt(trial(21 * DAY), NOW)).toBe(NOW + 21 * DAY - TRIAL_REMINDER_MS);
    expect(trialReminderAt(trial(2 * DAY), NOW)).toBeNull();
    expect(trialReminderAt({ ...trial(21 * DAY), plan: 'plus', product: 'plus_month' }, NOW)).toBe(
      null,
    );
  });

  it('reminds three days before a yearly plan renews, only while it renews (N3)', () => {
    const yearly: Plan = {
      ...trial(0),
      plan: 'plus',
      product: 'plus_year',
      source: 'play',
      expiresAt: NOW + 300 * DAY,
      autoRenew: true,
      trialEndsAt: null,
    };
    expect(renewalReminderAt(yearly, NOW)).toBe(NOW + 300 * DAY - RENEWAL_REMINDER_MS);
    expect(renewalReminderAt({ ...yearly, autoRenew: false }, NOW)).toBeNull();
    expect(renewalReminderAt({ ...yearly, product: 'plus_month' }, NOW)).toBeNull();
    expect(renewalReminderAt({ ...yearly, expiresAt: NOW + 2 * DAY }, NOW)).toBeNull();
  });

  it("opens the store's own page for the subscription, and none for a test (N3)", () => {
    const plus: Plan = {
      ...trial(0),
      plan: 'plus',
      product: 'plus_month',
      source: 'play',
      autoRenew: true,
      trialEndsAt: null,
    };
    expect(manageUrl(plus, 'app.bargu')).toBe(
      'https://play.google.com/store/account/subscriptions?sku=plus_month&package=app.bargu',
    );
    expect(manageUrl({ ...plus, source: 'appstore' }, 'app.bargu')).toBe(
      'https://apps.apple.com/account/subscriptions',
    );
    expect(manageUrl({ ...plus, source: 'test' }, 'app.bargu')).toBeNull();
    expect(manageUrl(trial(DAY), 'app.bargu')).toBeNull();
  });

  it('says the trial ends soon only in its last three days', () => {
    expect(trialEndingSoon(trial(10 * DAY), NOW)).toBe(false);
    expect(trialEndingSoon(trial(3 * DAY), NOW)).toBe(true);
    expect(trialEndingSoon(trial(-DAY), NOW)).toBe(false);
    expect(daysLeft(NOW + 2 * DAY + 1, NOW)).toBe(3);
    expect(daysLeft(NOW - DAY, NOW)).toBe(0);
  });

  it('writes a price in lira as people read it', () => {
    expect(priceText(99.99, 'tr')).toContain('99,99');
    expect(priceText(799.99, 'en')).toContain('799.99');
  });
});
