import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import i18n, { resolveLanguage } from '@/i18n';

import { api } from '../auth/auth-store';
import { sendText } from '../messages/outbox';
import { pokeFromTap } from '../social/poke';
import { openSpot } from '../social/safe-spot';
import { isVaultOpen, vault } from '../storage/vault';
import { registerPushTask } from './background-push';
import { NEAR_CATEGORY, NEAR_REPLIES, type NearReply } from './channels';
import {
  circleOfResponse,
  enablePush,
  nearReplyOfResponse,
  pokeOfResponse,
  type PushState,
  routeOfResponse,
  safeOfResponse,
} from './push';

/** The server sends this phone its notices in this language, to this token (apps/api push). */
async function register(token: string): Promise<void> {
  await api.authed('/v1/push', {
    method: 'PUT',
    body: {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
      locale: resolveLanguage(i18n.language),
    },
  });
}

/** A quick answer's words, in this phone's language: they go as a plain text message. */
function replyWords(reply: NearReply): string {
  return reply === 'coming' ? i18n.t('messages.near.coming') : i18n.t('messages.near.notNow');
}

/** "Yakındayım" comes with two buttons (docs/ADR/0037); each opens the app and answers. */
function registerNearReplies(): Promise<unknown> {
  return Notifications.setNotificationCategoryAsync(
    NEAR_CATEGORY,
    NEAR_REPLIES.map((reply) => ({ identifier: reply, buttonTitle: replyWords(reply) })),
  );
}

function open(response: Notifications.NotificationResponse): void {
  // "Geliyorum" or "Şimdi olmaz": sent as a text, and the conversation opens with it in place (a
  // failure shows there, to be tried again).
  const near = nearReplyOfResponse(response);
  if (near !== null) {
    void sendText(near.conversation, replyWords(near.reply));
    router.push(`/messages/${near.conversation}`);
    return;
  }
  const route = routeOfResponse(response);
  if (route !== null) {
    router.push(route);
    return;
  }
  // A kiss, a hug, "Nerdesin?": it plays on screen (docs/ADR/0031).
  const poke = pokeOfResponse(response);
  if (poke !== null) {
    pokeFromTap(poke);
    return;
  }
  // "Güvendeyim" with a place: the map looks at it (a dot or a circle, docs/ADR/0029 §5). A place
  // a day old is gone from the vault: then the circle opens as for any notification.
  const safe = safeOfResponse(response);
  if (safe !== null && isVaultOpen() && openSpot(vault(), safe, Date.now())) return;
  const circleId = circleOfResponse(response);
  if (circleId !== null) router.push({ pathname: '/circle/[id]', params: { id: circleId } });
}

/** Registration as this app does it; `ask` shows the system question (docs/ADR/0022). */
function enable(ask: boolean): Promise<PushState> {
  return enablePush({
    register,
    channelName: i18n.t('notifications.channel'),
    placesChannelName: i18n.t('notifications.placesChannel'),
    meetingsChannelName: i18n.t('notifications.meetingsChannel'),
    privacyChannelName: i18n.t('notifications.privacyChannel'),
    accountChannelName: i18n.t('notifications.accountChannel'),
    safeQuietChannelName: i18n.t('notifications.safeQuietChannel'),
    ask,
  });
}

/** "Bildirimleri aç": the system question, in context (Google Play K11). */
export function askForPush(): Promise<PushState> {
  return enable(true);
}

/**
 * System notifications for the signed-in app: registers this phone when they are allowed (asked
 * in context, not at sign-in: NotificationCard), keeps the server's token current, opens the circle a tapped notification is about, and clears the tray
 * when the app comes to the front (the in-app notices take over).
 */
export function usePushNotifications(ready: boolean): void {
  useEffect(() => {
    if (!ready) return;
    void enable(false);
    // Notifications arrive sealed and data-only (docs/ADR/0016): this task opens and shows them.
    if (Platform.OS === 'android') void registerPushTask().catch(() => undefined);
    void registerNearReplies().catch(() => undefined);
    const tokens = Notifications.addPushTokenListener((token) => {
      const data: unknown = token.data;
      if (typeof data === 'string') void register(data).catch(() => undefined);
    });
    const taps = Notifications.addNotificationResponseReceivedListener(open);
    // Opened by tapping a notification while the app was closed.
    const launch = Notifications.getLastNotificationResponse();
    if (launch !== null) {
      open(launch);
      Notifications.clearLastNotificationResponse();
    }
    void Notifications.dismissAllNotificationsAsync();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void Notifications.dismissAllNotificationsAsync();
    });
    return () => {
      tokens.remove();
      taps.remove();
      foreground.remove();
    };
  }, [ready]);
}
