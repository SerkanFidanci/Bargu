import type { Circle, ServerEvent } from '@bargu/schemas';
import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { create } from 'zustand';

import { env } from '@/config/env';

import { api, bootstrapAuth, onSignedOut, sessionRevoked, useAuth } from '../auth/auth-store';
import { announce } from '../circles/announce';
import { circlesKey } from '../circles/circle-cache';
import { createCircleSync } from '../circles/circle-sync';
import { endedEvents, nextEventEnd } from '../circles/event-time';
import { circlesApi } from '../circles/circles-api';
import { EventStream } from '../events/event-stream';
import { socketTransport } from '../events/socket-transport';
import { KeyStore } from '../keys/key-store';
import { queryClient } from '../query-client';
import { resetAppLock, restoreAppLock } from '../security/app-lock';
import { destroyVault, openVault, vault } from '../storage/vault';

let keyStore: KeyStore | null = null;

/** Whether the live connection is up and caught up (the map says "Connecting…" otherwise). */
export const useConnection = create<{ online: boolean; drops: number }>(() => ({
  online: false,
  /** Counts connection losses, so a view can tell one outage from the next. */
  drops: 0,
}));

function setOnline(online: boolean): void {
  const current = useConnection.getState();
  if (current.online === online) return;
  useConnection.setState({ online, drops: online ? current.drops : current.drops + 1 });
}

type LiveListener = (name: string, payload: unknown) => void;
const liveListeners = new Set<LiveListener>();
const eventListeners = new Set<(events: readonly ServerEvent[]) => void>();

/** Resumable server events as they are applied (places use `places.changed`); the unsubscribe. */
export function onServerEvents(listener: (events: readonly ServerEvent[]) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}
const onlineListeners = new Set<() => void>();

/** Live messages from the relay (locations, watch requests); returns the unsubscribe. */
export function onLiveMessage(listener: LiveListener): () => void {
  liveListeners.add(listener);
  return () => liveListeners.delete(listener);
}

/** Runs after every (re)connection once caught up; returns the unsubscribe. */
export function onOnline(listener: () => void): () => void {
  onlineListeners.add(listener);
  return () => onlineListeners.delete(listener);
}

/** The signed-in user's key store on this device (vault must be open). */
export function keys(): KeyStore {
  const { device, userId } = useAuth.getState();
  if (device === null || userId === null) throw new Error('keys used while signed out');
  if (keyStore?.belongsTo(userId, device.deviceId) !== true) {
    keyStore = new KeyStore(vault(), { userId, device });
  }
  return keyStore;
}

const firstLoadListeners = new Set<(circles: readonly Circle[]) => void>();

/**
 * This phone's first load found circles the account is already in (reinstall, new phone); runs
 * before they show or get anything. Returns the unsubscribe.
 */
export function onFirstLoad(listener: (circles: readonly Circle[]) => void): () => void {
  firstLoadListeners.add(listener);
  return () => firstLoadListeners.delete(listener);
}

const goneListeners = new Set<(isGone: (circleId: string) => boolean) => void>();

/**
 * Circles the account is no longer in, as the server said (see CircleSyncDeps.gone). Returns the
 * unsubscribe.
 */
export function onCirclesGone(
  listener: (isGone: (circleId: string) => boolean) => void,
): () => void {
  goneListeners.add(listener);
  return () => goneListeners.delete(listener);
}

export const circleSync = createCircleSync({
  queryClient,
  api: circlesApi,
  keys,
  notify: announce,
  firstLoad: (circles) => {
    for (const listener of firstLoadListeners) listener(circles);
  },
  gone: (isGone) => {
    for (const listener of goneListeners) listener(isGone);
  },
});

const stream = new EventStream({
  transport: socketTransport(env.apiUrl, (path) => api.socketHandshake(path)),
  store: { ...lazyVault() },
  apply: (events) => {
    for (const listener of eventListeners) listener(events);
    return circleSync.apply(events);
  },
  reload: () => circleSync.reload(),
  denied: (code) => {
    if (code === 'DEVICE_REVOKED') void sessionRevoked();
  },
  online: (online) => {
    setOnline(online);
    if (online) for (const listener of onlineListeners) listener();
  },
  live: (name, payload) => {
    for (const listener of liveListeners) listener(name, payload);
  },
});

/** A request over the live connection; null when it is down (the caller uses HTTP instead). */
export function liveRequest(name: string, payload?: unknown): Promise<unknown> | null {
  return stream.request(name, payload);
}

/**
 * For work that may start without the app on screen (the background location task): reads the
 * session and opens the vault if the app has not. False when nobody is signed in.
 */
export async function ensureSession(): Promise<boolean> {
  if (useAuth.getState().status === 'loading') await bootstrapAuth();
  if (useAuth.getState().status !== 'signedIn') return false;
  await openVault();
  return true;
}

/** The stream starts before anything else touches the vault: resolve it on each call. */
function lazyVault() {
  return {
    get: (key: string) => vault().get(key),
    set: (key: string, value: string) => {
      vault().set(key, value);
    },
    delete: (key: string) => {
      vault().delete(key);
    },
    keys: () => vault().keys(),
    clear: () => {
      vault().clear();
    },
  };
}

/**
 * Event circles end on this phone on time, whether or not the server's notice gets through: the
 * circle goes from every screen and its keys are thrown away (docs/ADR/0017).
 */
let eventTimer: ReturnType<typeof setTimeout> | null = null;
function endEventsDue(): void {
  if (eventTimer !== null) clearTimeout(eventTimer);
  eventTimer = null;
  const circles = queryClient.getQueryData<Circle[]>(circlesKey) ?? [];
  const now = Date.now();
  for (const circleId of endedEvents(circles, now)) circleSync.drop(circleId);
  const next = nextEventEnd(circles, now);
  // Timers longer than about 24 days overflow; events last a week at most anyway.
  if (next !== null) eventTimer = setTimeout(endEventsDue, Math.min(next - now + 500, 2 ** 31 - 1));
}
const CIRCLES_HASH = JSON.stringify(circlesKey);
queryClient.getQueryCache().subscribe((event) => {
  if (event.query.queryHash === CIRCLES_HASH && event.type === 'updated') endEventsDue();
});
AppState.addEventListener('change', (state) => {
  if (state === 'active') endEventsDue();
});

// Nothing of one account may survive into the next sign-in: connection, keys, position.
onSignedOut(() => {
  resetAppLock();
  stream.reset();
  setOnline(false);
  keyStore = null;
  void destroyVault();
});

/**
 * Opens the vault and keeps the live connection up while the signed-in app is in the foreground:
 * disconnects in the background, reconnects (and catches up) on return or when the network comes
 * back. Returns false until the vault is open, so nothing reads keys before that.
 */
export function useLiveSession(): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    openVault().then(
      () => {
        if (!active) return;
        // Before anything shows: a locked app shows nothing until the phone confirms its owner.
        restoreAppLock(vault());
        setReady(true);
        if (AppState.currentState === 'active') stream.start();
      },
      () => {
        // The secure store failed (rare): the app stays usable, without live updates and keys.
        if (active) setReady(true);
      },
    );
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        stream.start();
      } else if (state === 'background') {
        stream.stop();
        setOnline(false);
      }
    });
    const network = NetInfo.addEventListener((state) => {
      if (state.isConnected === true) stream.wake();
    });
    return () => {
      active = false;
      appState.remove();
      network();
      stream.stop();
    };
  }, []);

  return ready;
}
