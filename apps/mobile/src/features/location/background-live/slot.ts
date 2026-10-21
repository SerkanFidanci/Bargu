import type { ReactElement } from 'react';
import { create } from 'zustand';

/**
 * Background live mode (docs/ADR/0028 step 3) is only in development and preview builds for now
 * (EXPO_PUBLIC_BG_LIVE, index.ts): a production bundle does not contain it, so there `current`
 * stays null, the slots stay empty, and a `watch` notice is dropped like any notice this app has
 * no use for. Production gets it after the preview trial and the PM's approval.
 */
export interface BackgroundLive {
  /** A `watch` notice arrived for this circle: go live for a while if every stop allows it. */
  notice(circleId: string): Promise<void>;
}

export const backgroundLive: {
  current: BackgroundLive | null;
  /** The feature's code while it loads (index.ts imports it only when the build has the flag). */
  loading: Promise<unknown> | null;
} = { current: null, loading: null };

export const useBackgroundLiveSlots = create<{
  /** The "Arka planda canlı konum" row of the location settings. */
  settingsRow: ReactElement | null;
  /** The one-time explanation card on the map. */
  mapCard: ReactElement | null;
}>(() => ({ settingsRow: null, mapCard: null }));
