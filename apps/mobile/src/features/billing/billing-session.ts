import type { Plan } from '@bargu/schemas';
import { hashKey } from '@tanstack/react-query';

import i18n from '@/i18n';

import { onSignedOut } from '../auth/auth-store';
import { onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { planKey } from './plan';
import { trialReminderAt } from './plan-model';
import { cancelTrialReminder, scheduleTrialReminder } from './trial-reminder';

/**
 * The plan follows its events (docs/ADR/0024 §2: bought, renewed, ran out; never polled) and, back
 * online, is asked once again. Whenever it changes, the trial reminder is set for three days
 * before the trial ends, or taken back.
 */
function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: planKey });
}

onServerEvents((events) => {
  if (events.some((event) => event.type === 'plan.changed')) refresh();
});
onOnline(refresh);

const PLAN_HASH = hashKey(planKey);
let planned: number | null | undefined;
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash !== PLAN_HASH) return;
  const plan = event.query.state.data as Plan | undefined;
  if (plan === undefined) return;
  const at = trialReminderAt(plan, Date.now());
  if (at === planned) return;
  planned = at;
  if (at === null) {
    void cancelTrialReminder().catch(() => undefined);
    return;
  }
  void scheduleTrialReminder(at, {
    title: i18n.t('plus.reminder.title'),
    body: i18n.t('plus.reminder.body'),
  }).catch(() => undefined);
});

onSignedOut(() => {
  planned = undefined;
  void cancelTrialReminder().catch(() => undefined);
});
