import { generateToken } from '@bargu/crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, deleteMMKV } from 'react-native-mmkv';

import type { KeyValueStore } from '../../storage/vault';
import type { MonthFiles } from './own-trail';

/**
 * The real month files of one's own history (docs/ADR/0030 §3): one AES-256 MMKV file per month,
 * its key a secure-store entry apart from the vault's, readable only with this phone unlocked
 * (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`). With the phone locked the key cannot be read: the files are
 * simply not there for the app then, and what comes meanwhile waits in the vault.
 */
const KEY_ENTRY = 'bargu.trail.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
const KEY_CHARS = 32;
/** Which months have a file (MMKV cannot list its files): in the vault, as a JSON list. */
const MONTHS_KEY = 'own:months:v1';
const idOf = (month: string) => `bargu-trail-${month}`;

let key: string | null = null;

/** Whether the key was read: the files can be opened (the phone was unlocked). */
export function trailKeyReady(): boolean {
  return key !== null;
}

/**
 * Reads the key (creating it when `create`: the first time the history is turned on). False when
 * the phone is locked or the entry is not there to read. Call it where the app is in front, not in
 * the background task.
 */
export async function prepareTrailKey(create: boolean): Promise<boolean> {
  if (key !== null) return true;
  try {
    let found = await SecureStore.getItemAsync(KEY_ENTRY, OPTIONS);
    if (found?.length !== KEY_CHARS) {
      if (!create) return false;
      found = generateToken().slice(0, KEY_CHARS);
      await SecureStore.setItemAsync(KEY_ENTRY, found, OPTIONS);
    }
    key = found;
    return true;
  } catch {
    // Locked, or the secure store could not be read now: the files wait.
    return false;
  }
}

/** Forgets the key from memory (the phone locked, or sign-out). */
export function forgetTrailKey(): void {
  key = null;
}

/** The months a year of history and the month it is in can be in: for deleting without an index. */
function recentMonths(now: number): string[] {
  const at = new Date(now);
  return Array.from({ length: 15 }, (_, back) => {
    const month = new Date(at.getFullYear(), at.getMonth() - back, 1);
    return `${String(month.getFullYear())}-${String(month.getMonth() + 1).padStart(2, '0')}`;
  });
}

function months(vault: KeyValueStore): string[] {
  const raw = vault.get(MONTHS_KEY);
  if (raw === undefined) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((month): month is string => typeof month === 'string')
      : [];
  } catch {
    return [];
  }
}

export function createMonthFiles(vault: () => KeyValueStore): MonthFiles {
  return {
    months: () => months(vault()),
    open: (month) => {
      if (key === null) throw new Error('trail files used before their key was read');
      const file = createMMKV({ id: idOf(month), encryptionKey: key, encryptionType: 'AES-256' });
      const known = months(vault());
      if (!known.includes(month)) vault().set(MONTHS_KEY, JSON.stringify([...known, month].sort()));
      return {
        store: {
          get: (name) => file.getString(name),
          set: (name, value) => {
            file.set(name, value);
          },
          delete: (name) => {
            file.remove(name);
          },
          keys: () => file.getAllKeys(),
          clear: () => {
            file.clearAll();
          },
        },
        // MMKV does not shrink after deletions: a closed month is made as small as it can be.
        close: () => {
          file.trim();
        },
      };
    },
    destroy: () => {
      // Not only the listed months: at sign-out the vault (and its list) may already be gone.
      let listed: string[] = [];
      try {
        listed = months(vault());
        vault().delete(MONTHS_KEY);
      } catch {
        // The vault is closed already.
      }
      for (const month of new Set([...listed, ...recentMonths(Date.now())])) {
        deleteMMKV(idOf(month));
      }
      key = null;
      void SecureStore.deleteItemAsync(KEY_ENTRY, OPTIONS).catch(() => undefined);
    },
  };
}
