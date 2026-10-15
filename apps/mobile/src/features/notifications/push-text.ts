import type { PushBody } from '@bargu/schemas';

import i18n from '@/i18n';

import { MEETINGS_CHANNEL, PLACES_CHANNEL, SOCIAL_CHANNEL } from './channels';
import type { PushContacts } from './push-contacts';

export interface ShownPush {
  title: string;
  body: string;
  /** Tapping opens this circle. */
  circleId: string;
  channel: typeof SOCIAL_CHANNEL | typeof PLACES_CHANNEL | typeof MEETINGS_CHANNEL;
  /** Who it is about (for muting); null for the server's notices. */
  fromUserId: string | null;
}

/**
 * The words of an opened notification, in the phone's language. A member's notification names
 * them as this phone knows them (never a name sent along); null when the sender is unknown.
 */
export function pushText(
  body: PushBody,
  senderDeviceId: string | null,
  contacts: PushContacts,
): ShownPush | null {
  if (body.kind === 'notice') {
    const circle = contacts.circles[body.circleId]?.name ?? '';
    const text =
      body.notice === 'memberJoined' && circle !== ''
        ? i18n.t('notifications.notice.memberJoinedIn', { circle })
        : i18n.t(`notifications.notice.${body.notice}`);
    return {
      title: 'Bargu',
      body: text,
      circleId: body.circleId,
      channel: SOCIAL_CHANNEL,
      fromUserId: null,
    };
  }
  const sender = senderDeviceId === null ? undefined : contacts.devices[senderDeviceId];
  if (sender === undefined) return null;
  if (body.kind === 'bump') {
    return {
      title: 'Bargu',
      body: i18n.t('notifications.poked', { name: sender.name }),
      circleId: body.circleId,
      channel: SOCIAL_CHANNEL,
      fromUserId: sender.userId,
    };
  }
  if (body.kind === 'late') {
    const circle = contacts.circles[body.circleId]?.name;
    return {
      title: circle ?? 'Bargu',
      body: i18n.t('notifications.late', { name: sender.name, minutes: body.minutes }),
      circleId: body.circleId,
      channel: MEETINGS_CHANNEL,
      fromUserId: sender.userId,
    };
  }
  return {
    title: `${body.emoji} ${body.name}`,
    body: i18n.t(body.event === 'enter' ? 'notifications.arrived' : 'notifications.left', {
      name: sender.name,
    }),
    circleId: body.circleId,
    channel: PLACES_CHANNEL,
    fromUserId: sender.userId,
  };
}
