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

/**
 * The lines made to match what is due (person-share.ts shareEndsDue): a line not due goes (a
 * paused or ended friendship), a due one this phone has not set is set (a pause lifted with time
 * left). One already set stays as it is: choosing a new end sets it again where it is chosen.
 */
export async function reconcileShareEnds(
  due: readonly { circleId: string; at: number; text: { title: string; body: string } }[],
): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  const set = new Set(
    scheduled
      .map((notification) => notification.identifier)
      .filter((identifier) => identifier.startsWith(idOf(''))),
  );
  const wanted = new Set(due.map((line) => idOf(line.circleId)));
  for (const identifier of set) {
    if (!wanted.has(identifier)) await Notifications.cancelScheduledNotificationAsync(identifier);
  }
  for (const line of due) {
    if (!set.has(idOf(line.circleId))) await scheduleShareEnd(line.circleId, line.at, line.text);
  }
}

/**
 * Every such line this phone set, gone: at sign-out and with the account (QA-42: they carry a
 * friend's name).
 */
export async function cancelAllShareEnds(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.identifier.startsWith(idOf('')))
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier),
      ),
  );
}
