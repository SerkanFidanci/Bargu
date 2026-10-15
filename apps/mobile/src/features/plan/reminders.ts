import * as Notifications from 'expo-notifications';

import { MEETINGS_CHANNEL } from '../notifications/channels';
import type { ReminderText } from './meeting';

/** One reminder per event: a new one replaces the earlier (same identifier). */
const idOf = (circleId: string) => `meeting-leave:${circleId}`;

/**
 * "15 dk içinde çıkmalısın": a local notification, set on this phone at the time worked out here
 * (nothing about it goes to the server or to a push service), or shown now (`at` null).
 */
export async function remindToLeave(
  circleId: string,
  at: number | null,
  text: ReminderText,
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: idOf(circleId),
    content: { title: text.title, body: text.body, data: { circleId } },
    trigger:
      at === null
        ? { channelId: MEETINGS_CHANNEL }
        : {
            type: Notifications.SchedulableTriggerInputTypes.DATE,
            date: at,
            channelId: MEETINGS_CHANNEL,
          },
  });
}

export async function cancelReminder(circleId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idOf(circleId));
}

/** Sign-out: no reminder of this account may come later (they name its places). */
export async function cancelAllReminders(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  for (const request of scheduled) {
    if (request.identifier.startsWith(idOf(''))) {
      await Notifications.cancelScheduledNotificationAsync(request.identifier);
    }
  }
}
