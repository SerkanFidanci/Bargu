import { generateToken } from '@bargu/crypto';
import * as SecureStore from 'expo-secure-store';
import { createMMKV, type MMKV } from 'react-native-mmkv';

/**
 * Small encrypted key-value store for what must survive restarts but never leave the phone:
 * sender keys, sequence and replay state, known identity keys, the last event id (BARGU_PLAN §1:
 * "MMKV (şifreli, anahtar SecureStore'da)"). MMKV encrypts the file with AES-256; its key lives
 * in the Keychain / Keystore with the device keys (this device only, never backed up).
 */
export interface KeyValueStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
  delete(key: string): void;
  keys(): string[];
  clear(): void;
}

/** Secure-store entry holding the vault's encryption key. */
const STORAGE_KEY = 'bargu.vault.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
/** MMKV takes a 32-character key for AES-256: 24 random bytes in base64url. */
const KEY_CHARS = 32;

let store: KeyValueStore | null = null;
/** The first open, shared by callers that race (the app and a background location task). */
let opening: Promise<KeyValueStore> | null = null;

function wrap(mmkv: MMKV): KeyValueStore {
  return {
    get: (key) => mmkv.getString(key),
    set: (key, value) => {
      mmkv.set(key, value);
    },
    delete: (key) => {
      mmkv.remove(key);
    },
    keys: () => mmkv.getAllKeys(),
    clear: () => {
      mmkv.clearAll();
    },
  };
}

/** Opens (creating its key on first use) the vault. Call once signed in, before using it. */
export function openVault(): Promise<KeyValueStore> {
  if (store !== null) return Promise.resolve(store);
  opening ??= open().finally(() => {
    opening = null;
  });
  return opening;
}

/** Whether the vault is open (a background start may come before the app opened it). */
export function isVaultOpen(): boolean {
  return store !== null;
}

async function open(): Promise<KeyValueStore> {
  let key = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS);
  if (key?.length !== KEY_CHARS) {
    key = generateToken().slice(0, KEY_CHARS);
    await SecureStore.setItemAsync(STORAGE_KEY, key, OPTIONS);
  }
  store = wrap(createMMKV({ id: 'bargu-vault', encryptionKey: key, encryptionType: 'AES-256' }));
  return store;
}

/** The open vault; throws when used before openVault (a programming error, not a user state). */
export function vault(): KeyValueStore {
  if (store === null) throw new Error('vault used before openVault()');
  return store;
}

/** Sign-out: every key and state goes, and the vault key with it (nothing readable remains). */
export async function destroyVault(): Promise<void> {
  store?.clear();
  store = null;
  await SecureStore.deleteItemAsync(STORAGE_KEY, OPTIONS);
}
