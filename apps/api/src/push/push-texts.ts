import type { LOCALES } from '@bargu/schemas';

/** What happened, as far as the notification tells it (no names: docs/ADR/0010). */
export const PUSH_KINDS = [
  'friendRequest',
  'friendAccepted',
  'friendAdded',
  'circleInvite',
  'memberJoined',
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/**
 * Notification texts. They pass through Google (FCM) and Apple (APNs), so they say only what kind
 * of thing happened: never who, never which circle. The app shows the details once opened.
 */
const TEXTS: Record<(typeof LOCALES)[number], Record<PushKind, string>> = {
  tr: {
    friendRequest: 'Yeni bir arkadaşlık isteğin var',
    friendAccepted: 'Arkadaşlık isteğin kabul edildi',
    friendAdded: 'Yeni bir arkadaşın var',
    circleInvite: 'Bir çembere davet edildin',
    memberJoined: 'Çemberine yeni biri katıldı',
  },
  en: {
    friendRequest: 'You have a new friend request',
    friendAccepted: 'Your friend request was accepted',
    friendAdded: 'You have a new friend',
    circleInvite: 'You were invited to a circle',
    memberJoined: 'Someone joined your circle',
  },
};

export function pushText(
  kind: PushKind,
  locale: (typeof LOCALES)[number],
): { title: string; body: string } {
  return { title: 'Bargu', body: TEXTS[locale][kind] };
}
