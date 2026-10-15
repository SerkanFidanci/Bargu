import * as Notifications from 'expo-notifications';
import { AppState } from 'react-native';

import { toast } from '@/ui/toast';

import { SOCIAL_CHANNEL } from '../notifications/channels';

/**
 * "Artık X de geçmişini görebilir" (BARGU_PLAN, docs/ADR/0019): an in-app line while the app is
 * open, else a notification from this phone itself (nothing about it goes to a push service).
 */
export function tellNewViewer(text: string, circleId: string): void {
  if (AppState.currentState === 'active') {
    toast.info(text);
    return;
  }
  void Notifications.scheduleNotificationAsync({
    content: { title: 'Bargu', body: text, data: { circleId } },
    trigger: { channelId: SOCIAL_CHANNEL },
  }).catch(() => undefined);
}
