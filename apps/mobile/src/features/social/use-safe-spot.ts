import { router } from 'expo-router';
import { useEffect } from 'react';

import { useSafeSpot } from './safe-spot';

/**
 * A place was asked for (a "Güvendeyim" notification tapped, or its line in the open app): the
 * screens standing over the map make way for it. The map itself looks at the place (the home
 * screen, safe-spot-layer.tsx draws it). Mounted once, in the signed-in layout.
 */
export function useSafeSpotNavigation(): void {
  const request = useSafeSpot((state) => state.request);
  useEffect(() => {
    if (request > 0 && router.canDismiss()) router.dismissAll();
  }, [request]);
}
