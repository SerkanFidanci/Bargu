import { activityFx } from '@/theme/motion';

import type { MarkerActivity } from '@/ui/avatar-marker';

/** What someone seems to be doing, from their speed and how long they have stayed put. */
export type Activity = MarkerActivity;

/**
 * Speed alone decides moving activities (m/s from the phone's location service); staying within
 * 100 m for 30 minutes is "settled" (the sender says since when, location/stay.ts). Coarse
 * locations carry neither: still. Every viewer computes the same from the same message: a speed
 * arrives only from a sender who shows it, at the exact location, so a fast car, a train or a plane
 * shows only then. `fast`: false for this phone's own pin while its speed is not shown, which
 * then goes no further than a car.
 */
export function activityOf(
  spd: number | null | undefined,
  stayedMs: number,
  fast = true,
): Activity {
  const { walk, run, bike, drive, race, train, plane } = activityFx.speeds;
  if (spd !== null && spd !== undefined) {
    if (fast && spd >= plane) return 'plane';
    if (fast && spd >= train) return 'train';
    if (fast && spd >= race) return 'racing';
    if (spd >= drive) return 'driving';
    if (spd >= bike) return 'cycling';
    if (spd >= run) return 'running';
    if (spd >= walk) return 'walking';
  }
  return stayedMs >= activityFx.stay.settledMin * 60_000 ? 'settled' : 'still';
}
