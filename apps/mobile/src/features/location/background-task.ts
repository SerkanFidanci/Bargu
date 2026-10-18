import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { ensureSession } from '../live/live-session';
import { loadSharingSettings, locationEngine } from './location-session';
import { fixOf, LOCATION_TASK, stopTracking } from './tracker';

/**
 * The location service's callback, defined when the bundle loads (index.ts) so it also runs when
 * Android starts the app without a screen to deliver a location. It only ever passes the newest
 * fix to the engine, which encrypts it per circle before anything leaves the phone.
 */
TaskManager.defineTask<{ locations?: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const newest = (data.locations ?? []).reduce<LocationObject | null>(
    (best, location) => (best === null || location.timestamp > best.timestamp ? location : best),
    null,
  );
  if (newest === null) return;
  try {
    if (!(await ensureSession())) {
      // Signed out on this phone: nothing may be sent any more.
      await stopTracking();
      return;
    }
    loadSharingSettings();
    await locationEngine.fix(fixOf(newest), 'service');
    // Sharing ended meanwhile (time up, last circle left): no reason to keep the GPS on.
    if (!locationEngine.active()) await stopTracking();
  } catch {
    // The next fix tries again; nothing about the location is logged.
  }
});
