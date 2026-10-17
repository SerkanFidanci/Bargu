import * as Haptics from 'expo-haptics';

import { useEffectChoice } from './effects';
import { haptic, type HapticKind } from './motion';

const play: Record<(typeof haptic)[HapticKind], () => Promise<void>> = {
  selection: () => Haptics.selectionAsync(),
  success: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
  error: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error),
  heavy: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
};

/**
 * Plays the haptic for an interaction kind. Fire-and-forget: a device without a vibration motor
 * (or with haptics turned off in system settings) simply does nothing; nor does sade mod "off".
 */
export function feedback(kind: HapticKind): void {
  if (useEffectChoice.getState().level === 'off') return;
  play[haptic[kind]]().catch(() => undefined);
}
