import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { create } from 'zustand';

/** Android channel for friend and circle notices (users can tune it in system settings). */
export const SOCIAL_CHANNEL = 'social';

/**
 * enabled: system notifications on and this phone registered; denied: the user said no (only the
 * system settings can change it now); unavailable: this build cannot receive them (no push
 * service configured) or the registration failed; unknown: not checked yet.
 */
export type PushState = 'unknown' | 'enabled' | 'denied' | 'unavailable';

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
  /** Name of the Android channel, in the user's language. */
  channelName: string;
}

/**
 * Asks for permission (the system shows its dialog only while the user has not decided) and
 * registers this phone for notifications. On Android 13+ the dialog appears only once a channel
 * exists, so the channel comes first.
 */
export async function enablePush({ register, channelName }: PushRegistration): Promise<PushState> {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync(SOCIAL_CHANNEL, {
      name: channelName,
      importance: Notifications.AndroidImportance.HIGH,
    });
  }
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted && permission.canAskAgain) {
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
export function circleOfResponse(response: Notifications.NotificationResponse): string | null {
  const data: unknown = response.notification.request.content.data;
  if (typeof data !== 'object' || data === null) return null;
  const circleId = (data as Record<string, unknown>).circleId;
  return typeof circleId === 'string' && /^[0-9a-f-]{36}$/.test(circleId) ? circleId : null;
}
