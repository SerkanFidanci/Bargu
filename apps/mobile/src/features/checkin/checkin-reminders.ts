import * as Notifications from 'expo-notifications';

import { PRIVACY_CHANNEL, SAFETY_CHANNEL } from '../notifications/channels';

const idOf = (checkinId: string) => `checkin-due:${checkinId}`;
const OPEN_NOTICE = 'checkin-open';

// A native schedule may finish after its check was settled or its account signed out. Revisions
// invalidate that completion; the stale notification cancels itself instead of resurrecting.
const dueRevisions = new Map<string, number>();
let dueGeneration = 0;
function bumpDueRevision(checkinId: string): number {
  const revision = (dueRevisions.get(checkinId) ?? 0) + 1;
  dueRevisions.set(checkinId, revision);
  return revision;
}

// Native calls may finish out of order. Serialize reconciliation and skip stale requests so the
// latest requested visibility wins, including when a general tray clear happens on foregrounding.
let openNoticeRevision = 0;
let openNoticeQueue: Promise<void> = Promise.resolve();
function reconcileOpenNotice(action: () => Promise<unknown>): Promise<void> {
  const revision = ++openNoticeRevision;
  const run = openNoticeQueue
    .catch(() => undefined)
    .then(async () => {
      if (revision === openNoticeRevision) await action();
    });
  openNoticeQueue = run.catch(() => undefined);
  return run;
}

/**
 * An open check while the location service cannot run (no location permission, QA-44 Orta 2): a
 * lasting notice of its own says so, with who gets the alert, so no check is hidden (docs/ADR/0039
 * §10) and the person knows to tap "Vardım". A tap opens the checks.
 */
export function showOpenNotice(text: { title: string; body: string }): Promise<void> {
  return reconcileOpenNotice(() =>
    Notifications.scheduleNotificationAsync({
      identifier: OPEN_NOTICE,
      content: {
        title: text.title,
        body: text.body,
        sticky: true,
        autoDismiss: false,
        data: { route: 'ownChecks' },
      },
      trigger: { channelId: PRIVACY_CHANNEL },
    }),
  );
}

export function hideOpenNotice(): Promise<void> {
  return reconcileOpenNotice(() => Notifications.dismissNotificationAsync(OPEN_NOTICE));
}

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
  const generation = dueGeneration;
  const revision = bumpDueRevision(checkinId);
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
  if (generation !== dueGeneration || dueRevisions.get(checkinId) !== revision) {
    await Notifications.cancelScheduledNotificationAsync(idOf(checkinId)).catch(() => undefined);
    await Notifications.dismissNotificationAsync(idOf(checkinId)).catch(() => undefined);
  }
}

export async function cancelDue(checkinId: string): Promise<void> {
  bumpDueRevision(checkinId);
  await Notifications.cancelScheduledNotificationAsync(idOf(checkinId));
  await Notifications.dismissNotificationAsync(idOf(checkinId)).catch(() => undefined);
}

/** Every such reminder, gone (sign-out), including schedules still completing natively. */
export async function cancelAllDue(): Promise<void> {
  dueGeneration += 1;
  dueRevisions.clear();
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
