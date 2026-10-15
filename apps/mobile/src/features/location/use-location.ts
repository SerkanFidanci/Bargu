import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import i18n from '@/i18n';

import { useCircles } from '../circles/queries';
import { liveRequest, useConnection } from '../live/live-session';
import { useMyFix } from './engine';
import { locationEngine, restoreLocations, useLiveUntil } from './location-session';
import { useSharing } from './sharing';
import {
  checkLocationPermission,
  lastKnownFix,
  startTracking,
  stopTracking,
  useLocationPermission,
  watchLive,
} from './tracker';

/** "I am looking": renewed this often while the map is on screen (BARGU_PLAN §3.3 live mode). */
export const WATCH_RENEW_MS = 60_000;

function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState === 'active');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      setActive(state === 'active');
    });
    return () => {
      subscription.remove();
    };
  }, []);
  return active;
}

/** Re-renders when the earliest timed share ends, so the service stops right on time. */
function useNextExpiry(): number {
  const sharing = useSharing();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    const ends = Object.values(sharing.circles)
      .map((circle) => circle.until)
      .filter((until): until is number => until !== null && until > now);
    if (ends.length === 0) return;
    const timer = setTimeout(
      () => {
        void locationEngine.changed();
        setTick((value) => value + 1);
      },
      Math.min(...ends) - now + 1,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [sharing]);
  return tick;
}

/**
 * The signed-in app's side of the location engine (the permission is asked from the disclosure
 * card on the map, LocationBanner, never by itself: Google Play K10), keeps the location
 * service running while any circle gets the location (GPS only when one gets it exactly), and adds
 * 1-second updates while someone watches and the app is open.
 */
export function useLocationSession(ready: boolean): void {
  const active = useAppActive();
  const permission = useLocationPermission((state) => state.state);
  const sharing = useSharing();
  const circles = useCircles().data;
  const liveUntil = useLiveUntil((state) => state.until);
  const expiry = useNextExpiry();

  useEffect(() => {
    if (ready) restoreLocations();
  }, [ready]);

  // Checked again on every return: the user may have changed it in the system settings.
  useEffect(() => {
    if (ready && active) void checkLocationPermission();
  }, [ready, active]);

  // Where the map should look before the first fix (nothing is sent from this).
  useEffect(() => {
    if (!ready || permission !== 'granted' || useMyFix.getState().fix !== null) return;
    void lastKnownFix().then(
      (fix) => {
        if (fix !== null && useMyFix.getState().fix === null) useMyFix.setState({ fix });
      },
      () => undefined,
    );
  }, [ready, permission]);

  useEffect(() => {
    // Android starts the service only from the foreground; once on, it outlives the screen.
    if (!ready || !active || permission !== 'granted' || circles === undefined) return;
    if (!locationEngine.active()) {
      void stopTracking().catch(() => undefined);
      return;
    }
    void startTracking({
      gps: locationEngine.gps(),
      title: i18n.t('location.service.title'),
      body: i18n.t('location.service.body'),
    }).catch(() => undefined);
  }, [ready, active, permission, circles, sharing, expiry]);

  useEffect(() => {
    const remaining = liveUntil - Date.now();
    if (!ready || !active || permission !== 'granted' || remaining <= 0) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void watchLive((fix) => {
      void locationEngine.fix(fix);
    }).then(
      (stopWatching) => {
        if (cancelled) stopWatching();
        else stop = stopWatching;
      },
      () => undefined,
    );
    const timer = setTimeout(() => {
      stop?.();
      stop = null;
    }, remaining);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      stop?.();
    };
  }, [ready, active, permission, liveUntil]);
}

/**
 * While the map is on screen, tells the circles' members that someone is looking (their phones
 * then send every second for a while). Renewed every minute and after each reconnection.
 */
export function useWatchCircles(): void {
  const circles = useCircles().data;
  const online = useConnection((state) => state.online);
  const active = useAppActive();
  // Only circles with someone else in them; a stable key so cache updates do not resend.
  const watched = (circles ?? [])
    .filter(
      (circle) =>
        circle.myStatus === 'active' &&
        circle.members.filter((member) => member.status === 'active').length > 1,
    )
    .map((circle) => circle.id)
    .join(',');

  useFocusEffect(
    useCallback(() => {
      if (!active || !online || watched === '') return;
      const watch = () => {
        for (const circleId of watched.split(',')) {
          void liveRequest('watch', { circleId })?.catch(() => null);
        }
      };
      watch();
      const timer = setInterval(watch, WATCH_RENEW_MS);
      return () => {
        clearInterval(timer);
      };
    }, [active, online, watched]),
  );
}
