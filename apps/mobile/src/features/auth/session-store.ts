import { type Session, sessionSchema } from '@bargu/schemas';
import * as SecureStore from 'expo-secure-store';

import type { SessionStore } from './api-client';

const STORAGE_KEY = 'bargu.session.v1';

/** Same keychain class as the device keys: after first unlock, this device only, never backed up. */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * The session (refresh token and current access token) in the secure store, mirrored in memory so
 * every request reads it synchronously. A stored value that no longer parses is treated as no
 * session (the user signs in again) rather than crashing the app.
 */
export function createSecureSessionStore(): SessionStore & {
  load(): Promise<Session | null>;
  subscribe(listener: (session: Session | null) => void): () => void;
} {
  let current: Session | null = null;
  const listeners = new Set<(session: Session | null) => void>();

  return {
    get: () => current,
    async set(session) {
      current = session;
      if (session === null) await SecureStore.deleteItemAsync(STORAGE_KEY, OPTIONS);
      else await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(session), OPTIONS);
      for (const listener of listeners) listener(session);
    },
    async load() {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS);
      if (raw === null) return null;
      try {
        current = sessionSchema.parse(JSON.parse(raw));
      } catch {
        current = null;
        await SecureStore.deleteItemAsync(STORAGE_KEY, OPTIONS);
      }
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
