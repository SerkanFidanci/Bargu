import * as Notifications from 'expo-notifications';

import { PRIVACY_CHANNEL } from '../notifications/channels';

/** One weekly reminder at a time: a new one replaces the earlier (same identifier). */
const ID = 'sharing-review';

/** Set on this phone for `at` (nothing about it goes to the server); tapping opens who sees you. */
export async function scheduleSharingReminder(
  at: number,
  text: { title: string; body: string },
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: ID,
    content: { title: text.title, body: text.body, data: { route: 'seers' } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: PRIVACY_CHANNEL,
    },
  });
}

export async function cancelSharingReminder(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(ID);
}
