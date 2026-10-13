import NetInfo from '@react-native-community/netinfo';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { env } from '@/config/env';

import { api, onSignedOut, sessionRevoked, useAuth } from '../auth/auth-store';
import { createCircleSync } from '../circles/circle-sync';
import { circlesApi } from '../circles/circles-api';
import { EventStream } from '../events/event-stream';
import { socketTransport } from '../events/socket-transport';
import { KeyStore } from '../keys/key-store';
import { queryClient } from '../query-client';
import { destroyVault, openVault, vault } from '../storage/vault';

let keyStore: KeyStore | null = null;

/** The signed-in user's key store on this device (vault must be open). */
export function keys(): KeyStore {
  const { device, userId } = useAuth.getState();
  if (device === null || userId === null) throw new Error('keys used while signed out');
  if (keyStore?.belongsTo(userId, device.deviceId) !== true) {
    keyStore = new KeyStore(vault(), { userId, device });
  }
  return keyStore;
}

export const circleSync = createCircleSync({ queryClient, api: circlesApi, keys });

const stream = new EventStream({
  transport: socketTransport(env.apiUrl, (path) => api.socketHandshake(path)),
  store: { ...lazyVault() },
  apply: (events) => circleSync.apply(events),
  reload: () => circleSync.reload(),
  denied: (code) => {
    if (code === 'DEVICE_REVOKED') void sessionRevoked();
  },
});

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

// Nothing of one account may survive into the next sign-in: connection, keys, position.
onSignedOut(() => {
  stream.reset();
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
