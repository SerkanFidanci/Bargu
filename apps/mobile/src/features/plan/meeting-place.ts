import type { MeetingSpot } from '@bargu/schemas';
import { create } from 'zustand';

/**
 * A spot picked on the map from the "start a meeting" or "Düzenle" form (docs/ADR/0026 Ek 1): the
 * place editor, opened for a meeting, hands the point and its name back to the form. Nothing is
 * saved: the spot goes into the meeting itself.
 */
export const useMeetingPlaceDraft = create<{ circleId: string; spot: MeetingSpot } | null>(
  () => null,
);
