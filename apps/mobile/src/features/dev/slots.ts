import type { ReactElement } from 'react';
import { create } from 'zustand';

/** The developer screens behind the routes in app/_dev (one file per name). */
export type DevScreenName = 'crypto' | 'ui' | 'billing';

/**
 * Developer tools that only development and preview builds load (index.ts): the measurement
 * overlay (measure/index.ts) and the rest (tools.ts). A production bundle does not contain them,
 * so there these stay empty and nothing is drawn (docs/ADR/0028). This file holds no developer
 * text or code, only the empty places the screens read.
 */
export const useDevSlots = create<{
  /** Drawn over the map screen. */
  mapOverlay: ReactElement | null;
  /** Shows or hides it (a row in the "Uygulama" screen's developer section). */
  toggleOverlay: (() => void) | null;
  /** The developer rows of the "Uygulama" screen. */
  aboutRows: ReactElement | null;
  /** The fake people on the map, and the panel that measures and stops them. */
  swarmLayer: ReactElement | null;
  swarmPanel: ReactElement | null;
  /** The developer screens, for the routes in app/_dev. */
  screens: Partial<Record<DevScreenName, ReactElement>>;
}>(() => ({
  mapOverlay: null,
  toggleOverlay: null,
  aboutRows: null,
  swarmLayer: null,
  swarmPanel: null,
  screens: {},
}));
