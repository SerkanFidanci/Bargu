import type { Plan } from '@bargu/schemas';
import { hashKey } from '@tanstack/react-query';

import i18n from '@/i18n';

import { onSignedOut } from '../auth/auth-store';
import { onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { planKey } from './plan';
import { renewalReminderAt, trialReminderAt } from './plan-model';
import { plusPrice } from './store-prices';
import { cancelTrialReminder, scheduleTrialReminder } from './trial-reminder';

/**
 * The plan follows its events (docs/ADR/0024 §2: bought, renewed, ran out; never polled) and, back
 * online, is asked once again. Whenever it changes, the phone's own reminder is set for three days
 * before the trial ends or a yearly plan renews (N3), or taken back.
 */
function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: planKey });
}

onServerEvents((events) => {
  if (events.some((event) => event.type === 'plan.changed')) refresh();
});
onOnline(refresh);

/** "… tarihinde ₺799,99 alınacak" with the store's price, else without it. */
function renewalBody(date: string): string {
  const price = plusPrice('plus_year');
  return price === null
    ? i18n.t('plus.renewalReminder.bodyPlain', { date })
    : i18n.t('plus.renewalReminder.body', { date, price });
}

const PLAN_HASH = hashKey(planKey);
let planned: number | null | undefined;
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== PLAN_HASH) return;
  const plan = event.query.state.data as Plan | undefined;
  if (plan === undefined) return;
  const now = Date.now();
  const trial = trialReminderAt(plan, now);
  const renewal = trial === null ? renewalReminderAt(plan, now) : null;
  const at = trial ?? renewal;
  if (at === planned) return;
  planned = at;
  if (at === null) {
    void cancelTrialReminder().catch(() => undefined);
    return;
  }
  void scheduleTrialReminder(
    at,
    trial !== null || plan.expiresAt === null
      ? { title: i18n.t('plus.reminder.title'), body: i18n.t('plus.reminder.body') }
      : {
          title: i18n.t('plus.renewalReminder.title'),
          // The store's own price, or none (QA-42: never a guessed one).
          body: renewalBody(new Date(plan.expiresAt).toLocaleDateString(i18n.language)),
        },
  ).catch(() => undefined);
});

onSignedOut(() => {
  planned = undefined;
  void cancelTrialReminder().catch(() => undefined);
});
