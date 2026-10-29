import type { Circle } from '@bargu/schemas';
import * as Notifications from 'expo-notifications';

import { PRIVACY_CHANNEL } from '../notifications/channels';
import { circleSharing, type SharingSettings } from './sharing';

/** "1 saat daha": what one tap on the line at the end shares again (docs/ADR/0038). */
export const SHARE_AGAIN_MS = 60 * 60_000;

/**
 * Friendships whose timed share ran out after `since` and by `now` (docs/ADR/0038, the PM: the
 * friend goes from the map, and the user is told so in one line). A ghost ends nothing of this.
 */
export function endedFriendShares(
  settings: SharingSettings,
  circles: readonly Circle[],
  since: number,
  now: number,
): Circle[] {
  if (settings.ghost !== 'off') return [];
  return circles.filter((circle) => {
    if (circle.kind !== 'pair' || circle.myStatus !== 'active') return false;
    const sharing = circleSharing(settings, circle.id);
    return (
      sharing.sharing && sharing.until !== null && sharing.until > since && sharing.until <= now
    );
  });
}

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
