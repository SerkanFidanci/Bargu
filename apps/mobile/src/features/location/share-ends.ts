import * as Notifications from 'expo-notifications';

import { PRIVACY_CHANNEL } from '../notifications/channels';

const idOf = (circleId: string) => `share-end:${circleId}`;

/**
 * The same line when the app is closed at the end: set on this phone for that time (nothing about
 * it goes to the server); tapping opens the friendship. A newer choice replaces or cancels it.
 */
export async function scheduleShareEnd(
  circleId: string,
  at: number,
  text: { title: string; body: string },
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: idOf(circleId),
    content: { title: text.title, body: text.body, data: { circleId } },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: PRIVACY_CHANNEL,
    },
  });
}

export async function cancelShareEnd(circleId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idOf(circleId));
}
