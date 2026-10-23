import { router } from 'expo-router';

import { firstTap } from '../map/map-tap';
import type { Place } from './place-model';

/** A saved place's own screen (its editor: name, icon, size), from the map as from the circle. */
export function openPlace(place: Pick<Place, 'id' | 'circleId'>): void {
  if (!firstTap(`place:${place.id}`)) return;
  router.push({
    pathname: '/place/[circleId]',
    params: { circleId: place.circleId, id: place.id },
  });
}
