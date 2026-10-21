import * as Location from 'expo-location';
import { create } from 'zustand';

import type { Fix } from './send';

/** The one location task (background-task.ts runs it; also while the app is open). */
export const LOCATION_TASK = 'bargu.location';

/**
 * How often the location service reports (BARGU_PLAN §3.3): every 5 s with GPS when a circle gets
 * the exact location, every 30 s from Wi-Fi and cell towers when only coarse cells are shared. No
 * distance filter: a still phone still reports, so the 5-minute heartbeat goes out (send.ts).
 */
export const TRACKING = {
  gpsIntervalMs: 5_000,
  coarseIntervalMs: 30_000,
  liveIntervalMs: 1_000,
} as const;

/** Notification color of the "sharing location" service (brand violet, app.config.ts). */
const NOTIFICATION_COLOR = '#5B34F2';

/**
 * granted: can track (the "while using" permission is enough: on Android the location service
 * runs as a foreground service with a visible notification, also on a locked screen);
 * blocked: refused for good, only the system settings can change it; unknown: not checked yet.
 */
export type LocationPermission = 'unknown' | 'undetermined' | 'granted' | 'blocked';

export const useLocationPermission = create<{ state: LocationPermission }>(() => ({
  state: 'unknown',
}));

function remember(response: Location.LocationPermissionResponse): LocationPermission {
  const state: LocationPermission = response.granted
    ? 'granted'
    : response.canAskAgain
      ? 'undetermined'
      : 'blocked';
  useLocationPermission.setState({ state });
  return state;
}

export async function checkLocationPermission(): Promise<LocationPermission> {
  return remember(await Location.getForegroundPermissionsAsync());
}

/** Shows the system dialog (only while the user has not decided for good). */
export async function requestLocationPermission(): Promise<LocationPermission> {
  return remember(await Location.requestForegroundPermissionsAsync());
}

/** A platform position as the engine takes it; unknown values become null. */
export function fixOf(location: Location.LocationObject): Fix {
  const { latitude, longitude, accuracy, speed, heading } = location.coords;
  return {
    lat: latitude,
    lng: longitude,
    // No accuracy given: treat it as coarse rather than claim precision.
    acc: accuracy ?? 1_000,
    spd: speed !== null && speed >= 0 ? speed : null,
    hdg: heading !== null && heading >= 0 && (speed ?? 0) > 0 ? heading : null,
    ts: Math.round(location.timestamp),
  };
}

export interface TrackingOptions {
  /** GPS (exact location shared somewhere) or Wi-Fi and cell positioning only. */
  gps: boolean;
  /** Text of the ongoing notification, in the user's language. */
  title: string;
  body: string;
}

let running: TrackingOptions | null = null;

/**
 * Starts (or retunes) the location service. Android allows starting it only while the app is in
 * the foreground; once started it keeps running with the screen locked or the app in the
 * background, until stopped.
 */
export async function startTracking(options: TrackingOptions): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started && running !== null && running.gps === options.gps) return;
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: options.gps ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: options.gps ? TRACKING.gpsIntervalMs : TRACKING.coarseIntervalMs,
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.Other,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: options.title,
      notificationBody: options.body,
      notificationColor: NOTIFICATION_COLOR,
      // Swiping the app away keeps sharing; turning sharing off (or ghost mode) stops it.
      killServiceOnDestroy: false,
    },
  });
  running = options;
}

/** Stops the location service (nothing shared any more, or signed out). Allowed in background. */
export async function stopTracking(): Promise<void> {
  running = null;
  if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/** Whether the location service is running now (it outlives the screen once started). */
export function trackingStarted(): Promise<boolean> {
  return Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
}

/** The phone's last known position (no GPS start), e.g. to centre the map before any fix. */
export async function lastKnownFix(): Promise<Fix | null> {
  const location = await Location.getLastKnownPositionAsync();
  return location === null ? null : fixOf(location);
}

/**
 * One position now, for a single message ("Güvendeyim", docs/ADR/0029) when the engine has none
 * fresh: null when there is none within `timeoutMs` (no permission, no signal, location off).
 */
export async function currentFix(timeoutMs: number): Promise<Fix | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const location = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }),
    ]);
    return location === null ? null : fixOf(location);
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Live mode: GPS once a second on top of the location service, for as long as someone watches.
 * Returns the stop function. While the app is open this is the app's live mode; in the
 * background (docs/ADR/0028 step 3) it is what a `watch` notice opens for two minutes: the
 * location service cannot be retuned from there (expo-location refuses to start or change a
 * foreground service with the app in the background), but a watcher started while that service
 * runs gets positions in the process it keeps alive. If the OS delivers none, the caller notices.
 */
export async function watchLive(onFix: (fix: Fix) => void): Promise<() => void> {
  const subscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: TRACKING.liveIntervalMs,
      distanceInterval: 0,
    },
    (location) => {
      onFix(fixOf(location));
    },
  );
  return () => {
    subscription.remove();
  };
}
