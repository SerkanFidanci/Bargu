import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppState } from 'react-native';

import i18n from '@/i18n';

import { useAuth } from '../auth/auth-store';
import { memberName, partnerOf } from '../circles/names';
import { useCircles } from '../circles/queries';
import { toast } from '@/ui/toast';
import { liveRequest, useConnection } from '../live/live-session';
import { useMyFix } from './engine';
import { locationEngine, restoreLocations, updateSharing, useLiveUntil } from './location-session';
import { endedFriendShares, SHARE_AGAIN_MS, withPersonShare } from './person-share';
import { useSharing } from './sharing';
import { useMapOpen } from './map-open';
import { useSharingEnd } from './sharing-end';
import { refreshWhy, watchWhy } from './state-signals';
import {
  checkLocationPermission,
  lastKnownFix,
  startTracking,
  stopTracking,
  useLocationPermission,
  watchLive,
} from './tracker';

/** "I am looking": renewed this often while the map is on screen (BARGU_PLAN §3.3 live mode). */
const WATCH_RENEW_MS = 60_000;

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

/**
 * The signed-in app's side of the location engine (the permission is asked from the disclosure
 * card on the map, LocationBanner, never by itself: Google Play K10), keeps the location
 * service running while any circle gets the location (GPS only when one gets it exactly), and adds
 * 1-second updates while someone watches and the app is open, or while this phone's own map is on
 * screen (its own pin follows the GPS; sending keeps its rules, send.ts).
 */
/** Ends already told since this run began: a friendship's end is said once (docs/ADR/0038). */
let endsToldUpTo = Date.now();

export function useLocationSession(ready: boolean): void {
  const active = useAppActive();
  // Re-renders when the user's language changes (the texts the service and the restart notice hold).
  const { i18n: translator } = useTranslation();
  const language = translator.language;
  const permission = useLocationPermission((state) => state.state);
  const sharing = useSharing();
  const circles = useCircles().data;
  const liveUntil = useLiveUntil((state) => state.until);
  const mapOpen = useMapOpen((state) => state.open);
  const me = useAuth((state) => state.userId);
  // The earliest timed share's end: the service stops and every screen says so at once. A friend's
  // timed share says so in a line whose tap shares an hour more (the app closed, the phone's own
  // notification set for that time says it instead).
  const expiry = useSharingEnd(() => {
    void locationEngine.changed();
    const at = Date.now();
    for (const circle of endedFriendShares(
      useSharing.getState(),
      circles ?? [],
      endsToldUpTo,
      at,
    )) {
      const partner = partnerOf(circle, me);
      if (partner === undefined) continue;
      toast.notice(
        i18n.t('location.personShare.ended', { name: memberName(partner) }),
        'info',
        () => {
          updateSharing((settings) =>
            withPersonShare(settings, circle.id, {
              mode: 'until',
              until: Date.now() + SHARE_AGAIN_MS,
            }),
          );
        },
      );
    }
    endsToldUpTo = at;
  });

  useEffect(() => {
    if (ready) restoreLocations();
  }, [ready]);

  // A paused friendship sends nothing: the line set for its timed share's end goes (QA-42).
  useEffect(() => {
    const paused = (circles ?? []).filter(
      (circle) => circle.kind === 'pair' && circle.paused === true,
    );
    if (paused.length === 0) return;
    void import('./share-ends')
      .then(async (ends) => {
        for (const circle of paused) await ends.cancelShareEnd(circle.id);
      })
      .catch(() => undefined);
  }, [circles]);

  // Checked again on every return: the user may have changed it in the system settings. The same
  // goes for the location services and battery saver, which tell friends why a location is old.
  useEffect(() => {
    if (!ready || !active) return;
    void checkLocationPermission();
    watchWhy();
    void refreshWhy();
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
      restart: {
        title: i18n.t('location.service.stoppedTitle'),
        body: i18n.t('location.service.stoppedBody'),
      },
    }).catch(() => undefined);
    // The language is a dependency so the restart notice is rewritten when it changes.
  }, [ready, active, permission, circles, sharing, expiry, language]);

  useEffect(() => {
    const remaining = liveUntil - Date.now();
    const watched = remaining > 0;
    if (!ready || !active || permission !== 'granted' || (!watched && !mapOpen)) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    void watchLive((fix) => {
      void locationEngine.fix(fix, 'live');
    }).then(
      (stopWatching) => {
        if (cancelled) stopWatching();
        else stop = stopWatching;
      },
      () => undefined,
    );
    // Watched only: until the watching ends. With the map open: as long as it is (this effect ends).
    const timer = mapOpen
      ? null
      : setTimeout(() => {
          stop?.();
          stop = null;
        }, remaining);
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
      stop?.();
    };
  }, [ready, active, permission, liveUntil, mapOpen]);
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
