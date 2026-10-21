import * as Battery from 'expo-battery';
import { createElement } from 'react';
import { AppState } from 'react-native';

import { onSignedOut } from '../../auth/auth-store';
import { vault } from '../../storage/vault';
import { LIVE_MS } from '../engine';
import {
  loadSharingSettings,
  locationEngine,
  sendCircles,
  useLiveUntil,
} from '../location-session';
import { isSharingWith } from '../sharing';
import { trackingStarted, watchLive } from '../tracker';
import { BackgroundLiveCard } from './card';
import { BackgroundLiveRow } from './row';
import { createBackgroundLive } from './session';
import { backgroundLive, useBackgroundLiveSlots } from './slot';

/**
 * Background live mode (docs/ADR/0028 step 3), loaded by index.ts only in development and preview
 * builds (EXPO_PUBLIC_BG_LIVE): from here on a `watch` notice that reaches this phone can open a
 * live window, and the settings and the map have their row and card.
 */
const session = createBackgroundLive({
  settings: loadSharingSettings,
  circles: sendCircles,
  store: vault,
  battery: async () => {
    const [saver, state] = await Promise.all([
      Battery.isLowPowerModeEnabledAsync(),
      Battery.getPowerStateAsync(),
    ]);
    // The platform reports a negative level when it does not know: then it is not a stop.
    return { saver, level: state.batteryLevel < 0 ? -1 : state.batteryLevel * 100 };
  },
  appActive: () => AppState.currentState === 'active',
  // The notice reached an open app (the live connection was a moment late): the same as the live
  // `watch` event (location-session.ts), for a circle this phone shares with.
  foregroundWatch: (circleId) => {
    if (!isSharingWith(loadSharingSettings(), circleId, Date.now())) return;
    void locationEngine.watched();
    useLiveUntil.setState({ until: Date.now() + LIVE_MS });
  },
  serviceRunning: trackingStarted,
  watch: watchLive,
  engine: locationEngine,
  onForeground: (listener) => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') listener();
    });
    return () => {
      subscription.remove();
    };
  },
});

backgroundLive.current = {
  notice: async (circleId) => {
    await session.notice(circleId);
  },
};
useBackgroundLiveSlots.setState({
  settingsRow: createElement(BackgroundLiveRow),
  mapCard: createElement(BackgroundLiveCard),
});

onSignedOut(session.end);
