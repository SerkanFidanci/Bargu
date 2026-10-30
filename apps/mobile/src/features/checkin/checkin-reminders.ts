import * as Notifications from 'expo-notifications';

import { SAFETY_CHANNEL } from '../notifications/channels';

const idOf = (checkinId: string) => `checkin-due:${checkinId}`;

/** The buttons under "İyi misin?" (docs/ADR/0039 §7): each answers without opening a screen. */
export const CHECKIN_DUE_CATEGORY = 'checkin-due';
export const CHECKIN_OK = 'checkin-ok';
export const CHECKIN_EXTEND = 'checkin-extend';

export function registerCheckinButtons(words: { ok: string; extend: string }): Promise<unknown> {
  return Notifications.setNotificationCategoryAsync(CHECKIN_DUE_CATEGORY, [
    { identifier: CHECKIN_OK, buttonTitle: words.ok },
    { identifier: CHECKIN_EXTEND, buttonTitle: words.extend },
  ]);
}

/**
 * "İyi misin?" at the check's due time, set on this phone ahead (it needs no network: the phone
 * may be offline by then). A newer time replaces it; arriving cancels it.
 */
export async function scheduleDue(
  checkinId: string,
  at: number,
  text: { title: string; body: string },
): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    identifier: idOf(checkinId),
    content: {
      title: text.title,
      body: text.body,
      data: { checkinId },
      categoryIdentifier: CHECKIN_DUE_CATEGORY,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: at,
      channelId: SAFETY_CHANNEL,
    },
  });
}

export async function cancelDue(checkinId: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(idOf(checkinId));
  await Notifications.dismissNotificationAsync(idOf(checkinId)).catch(() => undefined);
}

/** Every such reminder, gone (sign-out). */
export async function cancelAllDue(): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((notification) => notification.identifier.startsWith(idOf('')))
      .map((notification) =>
        Notifications.cancelScheduledNotificationAsync(notification.identifier),
      ),
  );
}

/** Which check a tapped "İyi misin?" (or one of its buttons) is about. */
export function checkinOfResponse(response: Notifications.NotificationResponse): string | null {
  const data: unknown = response.notification.request.content.data;
  if (typeof data !== 'object' || data === null) return null;
  const id = (data as Record<string, unknown>).checkinId;
  return typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id) ? id : null;
}
