import { create } from 'zustand';

/**
 * A place added from the "start a meeting" screen (docs/ADR/0026 Ek 1): the place editor, opened
 * for a meeting, says which new place it saved, so the meeting can take it and let it go with it.
 * Only an id the editor made itself lands here, never a place the circle already had.
 */
export const useMeetingPlaceDraft = create<{ circleId: string; placeId: string } | null>(
  () => null,
);
