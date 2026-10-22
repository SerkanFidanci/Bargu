import { router } from 'expo-router';

import type { Place } from './place-model';

/** A saved place's own screen (its editor: name, icon, size), from the map as from the circle. */
export function openPlace(place: Pick<Place, 'id' | 'circleId'>): void {
  router.push({
    pathname: '/place/[circleId]',
    params: { circleId: place.circleId, id: place.id },
  });
}
