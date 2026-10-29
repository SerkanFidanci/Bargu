import {
  POKE_SAYINGS,
  POKE_STYLES,
  type PokeSaying,
  type PokeStyle,
  safeIdSchema,
} from '@bargu/schemas';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';

import {
  MEETINGS_CHANNEL,
  PLACES_CHANNEL,
  PRIVACY_CHANNEL,
  SOCIAL_CHANNEL,
  ACCOUNT_CHANNEL,
  SAFE_QUIET_CHANNEL,
  NEAR_REPLIES,
  type NearReply,
} from './channels';

/**
 * enabled: system notifications on and this phone registered; denied: the user said no (only the
 * system settings can change it now); unavailable: this build cannot receive them (no push
 * service configured) or the registration failed; unknown: not checked yet.
 */
/** `undetermined`: not asked yet (it is asked in context, docs/ADR/0022). */
export type PushState = 'unknown' | 'undetermined' | 'enabled' | 'denied' | 'unavailable';

export const usePushState = create<{ state: PushState }>(() => ({ state: 'unknown' }));

// While the app is open, in-app notices tell what happened: no system banner on top of them.
Notifications.setNotificationHandler({
  handleNotification: () =>
    Promise.resolve({
      shouldShowBanner: false,
      shouldShowList: false,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
});

export interface PushRegistration {
  /** Sends the phone's push token to the server (signed request). */
  register: (token: string) => Promise<void>;
  /** Names of the Android channels, in the user's language. */
  channelName: string;
  placesChannelName: string;
  meetingsChannelName: string;
  privacyChannelName: string;
  accountChannelName: string;
  /** The quiet summary of "Güvendeyim" messages past the hourly limit (docs/ADR/0029 §5). */
  safeQuietChannelName: string;
  /** Show the system question now (the user tapped "Bildirimleri aç"); else only check. */
  ask: boolean;
}

/**
 * Registers this phone for notifications when allowed; asks for the permission only with `ask`
 * (the system shows its dialog only while the user has not decided). On Android 13+ the dialog
 * appears only once a channel exists, so the channels come first.
 */
export async function enablePush({
  register,
  channelName,
  placesChannelName,
  meetingsChannelName,
  privacyChannelName,
  accountChannelName,
  safeQuietChannelName,
  ask,
}: PushRegistration): Promise<PushState> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SOCIAL_CHANNEL, {
      name: channelName,
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(PLACES_CHANNEL, {
      name: placesChannelName,
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(MEETINGS_CHANNEL, {
      name: meetingsChannelName,
      importance: Notifications.AndroidImportance.HIGH,
    });
    await Notifications.setNotificationChannelAsync(PRIVACY_CHANNEL, {
      name: privacyChannelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    await Notifications.setNotificationChannelAsync(ACCOUNT_CHANNEL, {
      name: accountChannelName,
      importance: Notifications.AndroidImportance.DEFAULT,
    });
    // Low importance: shown in the shade, never a sound, never a vibration.
    await Notifications.setNotificationChannelAsync(SAFE_QUIET_CHANNEL, {
      name: safeQuietChannelName,
      importance: Notifications.AndroidImportance.LOW,
      sound: null,
      enableVibrate: false,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
    if (!ask) return set('undetermined');
    permission = await Notifications.requestPermissionsAsync();
  }
  if (!permission.granted) return set('denied');
  try {
    const token: unknown = (await Notifications.getDevicePushTokenAsync()).data;
    if (typeof token !== 'string' || token.length === 0) return set('unavailable');
    await register(token);
  } catch {
    // No push service in this build yet, or offline: the app works, notices still show inside.
    return set('unavailable');
  }
  return set('enabled');
}

function set(state: PushState): PushState {
  usePushState.setState({ state });
  return state;
}

/** The circle a tapped notification is about, if it names one. */
/** A screen a tapped notification opens instead of a circle (the weekly reminder: who sees you). */
export function routeOfResponse(
  response: Notifications.NotificationResponse,
): '/seers' | '/guardians' | '/store?shelf=plus' | '/messages' | `/messages/${string}` | null {
  const data: unknown = response.notification.request.content.data;
  if (typeof data !== 'object' || data === null) return null;
  const { route } = data as Record<string, unknown>;
  if (route === 'seers') return '/seers';
  if (route === 'guardians') return '/guardians';
  // A new item of messages and moments (docs/ADR/0035 §11): its conversation.
  if (route === 'messages') {
    const { conversation } = data as Record<string, unknown>;
    return typeof conversation === 'string' && /^[cp]:[0-9a-f-]{36}$/.test(conversation)
      ? `/messages/${conversation}`
      : '/messages';
  }
  // The trial's reminder (features/billing/trial-reminder.ts): Bargu+ is a shelf of the store.
  if (route === 'plus') return '/store?shelf=plus';
  return null;
}

/**
 * "Geliyorum" or "Şimdi olmaz" under a "Yakındayım" (docs/ADR/0037): which, and the conversation it
 * answers. A tap on the notification itself is none of them.
 */
export function nearReplyOfResponse(
  response: Notifications.NotificationResponse,
): { reply: NearReply; conversation: `c:${string}` | `p:${string}` } | null {
  const reply = NEAR_REPLIES.find((candidate) => candidate === response.actionIdentifier);
  if (reply === undefined) return null;
  const route = routeOfResponse(response);
  if (!route?.startsWith('/messages/')) return null;
  const conversation = route.slice('/messages/'.length);
  return conversation.startsWith('c:') || conversation.startsWith('p:')
    ? { reply, conversation: conversation as `c:${string}` | `p:${string}` }
    : null;
}

/**
 * The "Güvendeyim" message a tapped notification is about (docs/ADR/0029 §5): its place is in the
 * vault, never in the notification, so this is only the message's id.
 */
export function safeOfResponse(response: Notifications.NotificationResponse): string | null {
  const data: unknown = response.notification.request.content.data;
  if (typeof data !== 'object' || data === null) return null;
  const parsed = safeIdSchema.safeParse((data as Record<string, unknown>).safe);
  return parsed.success ? parsed.data : null;
}

/** A tapped poke's notification (docs/ADR/0031): who, which, when; null for any other. */
const tappedPokeSchema = z.object({
  circleId: z.uuid(),
  poke: z.object({
    style: z.enum(POKE_STYLES),
    say: z.enum(POKE_SAYINGS).optional(),
    ts: z.number().int().nonnegative(),
    from: z.uuid(),
  }),
});

export function pokeOfResponse(response: Notifications.NotificationResponse): {
  circleId: string;
  from: string;
  style: PokeStyle;
  say?: PokeSaying | undefined;
  ts: number;
} | null {
  const parsed = tappedPokeSchema.safeParse(response.notification.request.content.data);
  if (!parsed.success) return null;
  const { circleId, poke } = parsed.data;
  return { circleId, ...poke };
}

export function circleOfResponse(response: Notifications.NotificationResponse): string | null {
  const data: unknown = response.notification.request.content.data;
  if (typeof data !== 'object' || data === null) return null;
  const circleId = (data as Record<string, unknown>).circleId;
  return typeof circleId === 'string' && /^[0-9a-f-]{36}$/.test(circleId) ? circleId : null;
}
