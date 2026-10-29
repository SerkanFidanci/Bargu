import * as Notifications from 'expo-notifications';

import { ACCOUNT_CHANNEL } from '../notifications/channels';

/**
 * One plan reminder at a time (the trial's end, or a yearly renewal, N3): a new one replaces the
 * earlier (same identifier).
 */
const ID = 'trial-ends';

/**
 * Set on this phone for `at`, three days before the trial ends (docs/ADR/0024 §4; nothing about it
 * goes to the server); tapping opens Bargu+.
 */
export async function scheduleTrialReminder(
  at: number,
  text: { title: string; body: string },
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: { title: text.title, body: text.body, data: { route: 'plus' } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: ACCOUNT_CHANNEL,
    },
  });
}

export async function cancelTrialReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID);
}
