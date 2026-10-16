import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';

import i18n, { resolveLanguage } from '@/i18n';

import { api } from '../auth/auth-store';
import { registerPushTask } from './background-push';
import { circleOfResponse, enablePush, type PushState, routeOfResponse } from './push';

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

function open(response: Notifications.NotificationResponse): void {
  const route = routeOfResponse(response);
  if (route !== null) {
    router.push(route);
    return;
  }
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
