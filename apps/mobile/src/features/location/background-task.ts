import type { LocationObject } from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { ensureSession } from '../live/live-session';
import { loadSharingSettings, locationEngine } from './location-session';
import { watchWhy } from './state-signals';
import { bestOfBatch, fixOf, LOCATION_TASK, stopTracking } from './tracker';

/**
 * The location service's callback, defined when the bundle loads (index.ts) so it also runs when
 * Android starts the app without a screen to deliver a location. Of a batch it passes one fix to
 * the engine, the sharpest of the newest (bestOfBatch), which the engine encrypts per circle before
 * anything leaves the phone.
 */
TaskManager.defineTask<{ locations?: LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error !== null) return;
  const newest = bestOfBatch(data.locations ?? []);
  if (newest === null) return;
  try {
    if (!(await ensureSession())) {
      // Signed out on this phone: nothing may be sent any more.
      await stopTracking();
      return;
    }
    loadSharingSettings();
    // Why a location is old (battery saver, permission, services) keeps being told from here too.
    watchWhy();
    await locationEngine.fix(fixOf(newest), 'service');
    // Sharing ended meanwhile (time up, last circle left): no reason to keep the GPS on.
    if (!locationEngine.active()) await stopTracking();
  } catch {
    // The next fix tries again; nothing about the location is logged.
  }
});
