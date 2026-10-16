import type { Plan } from '@bargu/schemas';

import {
  daysLeft,
  PLUS_PRICES,
  priceText,
  TRIAL_REMINDER_MS,
  trialEndingSoon,
  trialReminderAt,
  yearlySaving,
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

  it('says the trial ends soon only in its last three days', () => {
    expect(trialEndingSoon(trial(10 * DAY), NOW)).toBe(false);
    expect(trialEndingSoon(trial(3 * DAY), NOW)).toBe(true);
    expect(trialEndingSoon(trial(-DAY), NOW)).toBe(false);
    expect(daysLeft(NOW + 2 * DAY + 1, NOW)).toBe(3);
    expect(daysLeft(NOW - DAY, NOW)).toBe(0);
  });

  it('prices in lira, the yearly plan about a third off', () => {
    expect(yearlySaving()).toBe(33);
    expect(priceText(PLUS_PRICES.plus_month, 'tr')).toContain('99,99');
    expect(priceText(PLUS_PRICES.plus_year, 'en')).toContain('799.99');
  });
});
