import * as Battery from 'expo-battery';

import { stateReporter } from './location-session';
import {
  checkLocationPermission,
  checkLocationServices,
  type LocationPermission,
  useLocationPermission,
  useLocationServices,
} from './tracker';

/**
 * The permission as a reason: it was refused or taken back. (Whether friends hold a location that
 * this explains is the reporter's business: it says nothing for a phone that never shared one.)
 */
const permissionOff = (state: LocationPermission) =>
  state === 'blocked' || state === 'undetermined';

let watching = false;

/**
 * Starts listening to what keeps this phone's location from being fresh (docs/ADR/0028 "Neden
 * eski?"): the permission, the location services and battery saver. They tell the state reporter
 * when they change; the system says so by itself (the battery saver listener), or the app looks
 * again when it comes to the front (`refreshWhy`). Once per run, from the open app or from the
 * location service's background task.
 */
export function watchWhy(): void {
  if (watching) return;
  watching = true;
  useLocationPermission.subscribe((permission) => {
    void stateReporter.set({ permissionOff: permissionOff(permission.state) });
  });
  useLocationServices.subscribe((services) => {
    void stateReporter.set({ servicesOff: services.state === 'off' });
  });
  try {
    Battery.addLowPowerModeListener(({ lowPowerMode }) => {
      void stateReporter.set({ saver: lowPowerMode });
    });
  } catch {
    // No battery module here: battery saver is then not a reason.
  }
  void refreshWhy();
}

/** Reads again what may have changed while the app was not looking (it was in the background). */
export async function refreshWhy(): Promise<void> {
  await Promise.allSettled([
    checkLocationPermission(),
    checkLocationServices(),
    Promise.resolve()
      .then(() => Battery.isLowPowerModeEnabledAsync())
      .then((saver) => stateReporter.set({ saver })),
  ]);
}
