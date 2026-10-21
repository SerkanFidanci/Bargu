import { useMyFix } from './engine';
import type { Fix } from './send';

/**
 * Views of this phone's own position that change far less often than it does. With the map open
 * the position arrives every second (use-location.ts); a screen that listened to the position
 * itself was drawn again for every one of them, with everything under it. These follow only what
 * the screen needs: that there is a position, the square kilometre it is in.
 */

/** [lng, lat] of the first position this run knew; the map looks there once and stays. */
type LngLat = [number, number];

let first: LngLat | null = null;

/**
 * The first position known, the same array for as long as there is one (so a screen that
 * receives it is not told of a "new" place every second); null before the first position and
 * again after sign-out.
 */
export function firstPosition(state: { fix: Fix | null }): LngLat | null {
  if (state.fix === null) {
    first = null;
    return null;
  }
  first ??= [state.fix.lng, state.fix.lat];
  return first;
}

export function useFirstPosition(): LngLat | null {
  return useMyFix(firstPosition);
}

/** The square (about a kilometre) a position is in, as the weather card's town lookup keys it. */
export function positionCell(fix: Pick<Fix, 'lng' | 'lat'>): string {
  return `${fix.lng.toFixed(2)}:${fix.lat.toFixed(2)}`;
}

export function useMyCell(): string | null {
  return useMyFix((state) => (state.fix === null ? null : positionCell(state.fix)));
}
