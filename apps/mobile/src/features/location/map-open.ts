import { create } from 'zustand';

/**
 * The map is what the user sees (home, focused, app in the foreground): this phone's own pin then
 * follows the GPS every second (use-location.ts). Only for what is shown here: sending keeps its
 * own rules (send.ts), faster only while someone watches.
 */
export const useMapOpen = create<{ open: boolean }>(() => ({ open: false }));
