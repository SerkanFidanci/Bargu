import { activityFx } from '@/theme/motion';

import type { MarkerActivity } from '@/ui/avatar-marker';

/** What someone seems to be doing, from their speed and how long they have stayed put. */
export type Activity = MarkerActivity;

/**
 * Speed alone decides moving activities (m/s from the phone's location service); staying within
 * 100 m for 30 minutes is "settled" (the sender says since when, location/stay.ts). Coarse
 * locations carry neither: still. Every viewer computes the same from the same message.
 */
export function activityOf(spd: number | null | undefined, stayedMs: number): Activity {
  const { walk, run, bike, drive } = activityFx.speeds;
  if (spd !== null && spd !== undefined) {
    if (spd >= drive) return 'driving';
    if (spd >= bike) return 'cycling';
    if (spd >= run) return 'running';
    if (spd >= walk) return 'walking';
  }
  return stayedMs >= activityFx.stay.settledMin * 60_000 ? 'settled' : 'still';
}
