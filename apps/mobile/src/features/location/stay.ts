import { activityFx } from '@/theme/motion';

import { distanceM } from './send';

/** Where someone has been staying, and since when (Unix ms). */
export interface Stay {
  lat: number;
  lng: number;
  since: number;
}

/**
 * The stay after a new position: kept while within the stay radius, restarted when they move
 * away. The sender tracks its own and puts `since` into its exact location (send.ts), so every
 * viewer shows "settled" the same way.
 */
export function nextStay(
  current: Stay | null | undefined,
  at: { lat: number; lng: number },
  ts: number,
): Stay {
  if (
    current !== null &&
    current !== undefined &&
    distanceM(current, at) <= activityFx.stay.radiusM
  ) {
    return current;
  }
  return { lat: at.lat, lng: at.lng, since: ts };
}
