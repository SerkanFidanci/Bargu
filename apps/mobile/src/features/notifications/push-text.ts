import type { PushBody } from '@bargu/schemas';

import i18n from '@/i18n';

import type { SeenThere } from '../location/sharing';
import { safeWords } from '../social/safe';
import type { SafeSpot } from '../social/safe-spot';

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
  /** Tapping opens this screen instead of the circle (guardian notices name a link). */
  route?: 'guardians';
  /**
   * "Güvendeyim" with a place (docs/ADR/0029 §5): the phone keeps it for a day, and tapping the
   * notification shows it on the map.
   */
  spot?: SafeSpot;
}

const GUARDIAN_NOTICES: ReadonlySet<string> = new Set([
  'guardianRequest',
  'guardianLinked',
  'guardianEndRequested',
  'guardianEnded',
  'guardianApproval',
  'guardianApproved',
  'guardianDeclined',
  'guardianSettings',
  'guardianNewMember',
  'guardianPurchase',
  'guardianCosmetic',
]);

/**
 * The words of an opened notification, in the phone's language. A member's notification names
 * them as this phone knows them (never a name sent along); null when the sender is unknown.
 */
export function pushText(
  body: PushBody,
  senderDeviceId: string | null,
  contacts: PushContacts,
  /** What a circle sees of this phone: live location, history (Faz 9, docs/ADR/0019). */
  seenIn: (circleId: string) => SeenThere = () => ({ location: false, history: false }),
  /** The time the words are for ("Güvendeyim" says when it came late). */
  now: number = Date.now(),
): ShownPush | null {
  if (body.kind === 'notice') {
    // The silent signal of background live mode (docs/ADR/0028 step 3) has no words, ever.
    if (body.notice === 'watch') return null;
    if (GUARDIAN_NOTICES.has(body.notice)) {
      // docs/ADR/0023 §4: the "circle" is the link; the guardian screen shows who and what.
      // Someone new near the child: named after the child when this phone knows the link.
      const child = contacts.circles[body.circleId]?.name ?? '';
      return {
        title: 'Bargu',
        body:
          body.notice === 'guardianNewMember' && child !== ''
            ? i18n.t('notifications.notice.guardianNewMemberIn', { name: child })
            : i18n.t(`notifications.notice.${body.notice}`),
        circleId: body.circleId,
        channel: SOCIAL_CHANNEL,
        fromUserId: null,
        route: 'guardians',
      };
    }
    const circle = contacts.circles[body.circleId]?.name ?? '';
    // Someone new in a circle that sees the location or the history: they can see it too
    // (BARGU_PLAN Faz 9, QA G2).
    const seen =
      body.notice === 'memberJoined' ? seenIn(body.circleId) : { location: false, history: false };
    const what =
      seen.location && seen.history
        ? 'Both'
        : seen.location
          ? 'Sees'
          : seen.history
            ? 'History'
            : '';
    const text =
      body.notice !== 'memberJoined'
        ? i18n.t(`notifications.notice.${body.notice}`)
        : circle === ''
          ? i18n.t(`notifications.notice.memberJoined${what}`)
          : i18n.t(`notifications.notice.memberJoined${what}In`, { circle });
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
  if (body.kind === 'safe') {
    // "Güvendeyim" (docs/ADR/0029): who, from what this phone knows of them, and the battery.
    const circle = contacts.circles[body.circleId]?.name;
    return {
      title: circle ?? 'Bargu',
      body: safeWords({ name: sender.name, bat: body.bat, ts: body.ts, now }),
      circleId: body.circleId,
      channel: SOCIAL_CHANNEL,
      fromUserId: sender.userId,
      // From a phone before the place was in the notification, there is only the words.
      ...(body.lat === undefined || body.lng === undefined || body.acc === undefined
        ? {}
        : {
            spot: {
              id: body.id,
              circleId: body.circleId,
              name: sender.name,
              lat: body.lat,
              lng: body.lng,
              acc: body.acc,
              bat: body.bat,
              ts: body.ts,
            },
          }),
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
  if (body.kind === 'meeting') {
    // A member started a meeting in the circle (docs/ADR/0026 §6): who, when and where.
    const circle = contacts.circles[body.circleId]?.name;
    const time = new Date(body.meetAt).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    return {
      title: circle ?? 'Bargu',
      body: i18n.t('notifications.meeting', {
        name: sender.name,
        time,
        place: `${body.emoji} ${body.name}`,
      }),
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
