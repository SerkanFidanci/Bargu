import type { ReactElement } from 'react';
import { create } from 'zustand';

/**
 * Developer tools that only development and preview builds load (index.ts). A production bundle
 * does not contain them, so there these stay empty and nothing is drawn (docs/ADR/0028).
 */
export const useDevSlots = create<{
  /** Drawn over the map screen. */
  mapOverlay: ReactElement | null;
  /** Shows or hides it (a row in the Me sheet's developer section). */
  toggleOverlay: (() => void) | null;
}>(() => ({ mapOverlay: null, toggleOverlay: null }));
