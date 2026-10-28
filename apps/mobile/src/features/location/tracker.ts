import * as Location from 'expo-location';
import { create } from 'zustand';

import { armRestartNotice, disarmRestartNotice, type RestartText } from './restart-notice';
import type { Fix } from './send';

/** The one location task (background-task.ts runs it; also while the app is open). */
export const LOCATION_TASK = 'bargu.location';

/**
 * How often the location service reports (BARGU_PLAN §3.3, docs/ADR/0036): every 30 s with GPS when
 * a circle gets the exact location, every 60 s from Wi-Fi and cell towers when only coarse cells
 * are shared, so the GPS rests between positions instead of staying on (it was every 5 s, and
 * drained the battery even with the app closed: the owner, 2026-10-28). With the app in the
 * background the system gathers positions and wakes the app once a minute with them, so it sends
 * at most once a minute while moving. The 1-second live updates stay for the open map and for a
 * friend looking (background live mode). No distance filter: a still phone still reports, so the
 * 5-minute heartbeat goes out (send.ts).
 */
export const TRACKING = {
  gpsIntervalMs: 30_000,
  coarseIntervalMs: 60_000,
  liveIntervalMs: 1_000,
  /** In the background: positions wait and come together, at most this often (Android, iOS). */
  backgroundBatchMs: 60_000,
} as const;

/**
 * The position to use from a batch the system gathered in the background (docs/ADR/0036, QA-39):
 * the sharpest of the last minute, the batch's own length. Accuracies within 10 m of the sharpest
 * count as equal, and of those the newest is taken: a pin at the very latest place, not a few
 * metres sharper from half a minute ago.
 */
export const BATCH_WINDOW_MS = TRACKING.backgroundBatchMs;
export const SAME_ACCURACY_M = 10;

export function bestOfBatch<T extends { timestamp: number; coords: { accuracy: number | null } }>(
  locations: readonly T[],
): T | null {
  const newest = locations.reduce<T | null>(
    (best, location) => (best === null || location.timestamp > best.timestamp ? location : best),
    null,
  );
  if (newest === null) return null;
  const sharpness = (location: T) => location.coords.accuracy ?? Number.POSITIVE_INFINITY;
  const recent = locations.filter(
    (location) => newest.timestamp - location.timestamp <= BATCH_WINDOW_MS,
  );
  const sharpest = Math.min(...recent.map(sharpness));
  // None of them says how accurate it is: the newest.
  if (!Number.isFinite(sharpest)) return newest;
  return recent
    .filter((location) => sharpness(location) <= sharpest + SAME_ACCURACY_M)
    .reduce((best, location) => (location.timestamp > best.timestamp ? location : best));
}

/** Notification color of the "sharing location" service (brand navy, app.config.ts). */
const NOTIFICATION_COLOR = '#1E3F8A';

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

/**
 * Whether the phone's location services are switched on (the system switch, whatever the permission
 * of this app): off, no position can be had at all. `unknown` until checked.
 */
export type LocationServices = 'unknown' | 'on' | 'off';

export const useLocationServices = create<{ state: LocationServices }>(() => ({
  state: 'unknown',
}));

export async function checkLocationServices(): Promise<LocationServices> {
  const state: LocationServices = (await Location.hasServicesEnabledAsync()) ? 'on' : 'off';
  useLocationServices.setState({ state });
  return state;
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
  /**
   * The notice shown if the phone restarts or the app updates while this runs, in the user's
   * language (restart-notice.ts): the service does not come back by itself then.
   */
  restart: RestartText;
}

let running: TrackingOptions | null = null;

/**
 * Starts (or retunes) the location service. Android allows starting it only while the app is in
 * the foreground; once started it keeps running with the screen locked or the app in the
 * background, until stopped.
 */
export async function startTracking(options: TrackingOptions): Promise<void> {
  const started = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  if (started && running !== null && running.gps === options.gps) {
    // Running on purpose already; the notice is told again only when its text changed.
    armRestartNotice(options.restart);
    return;
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: options.gps ? Location.Accuracy.High : Location.Accuracy.Balanced,
    timeInterval: options.gps ? TRACKING.gpsIntervalMs : TRACKING.coarseIntervalMs,
    distanceInterval: 0,
    // Only while the app is not on screen (expo-location defers nothing in the foreground).
    deferredUpdatesInterval: TRACKING.backgroundBatchMs,
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
  // Started on purpose: if the phone restarts, the user is told it has stopped.
  armRestartNotice(options.restart);
}

/** Stops the location service (nothing shared any more, or signed out). Allowed in background. */
export async function stopTracking(): Promise<void> {
  running = null;
  // Before anything can fail: a share the user ended must never come back as a notice.
  disarmRestartNotice();
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
