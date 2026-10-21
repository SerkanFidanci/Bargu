import {
  fromBase64url,
  generateDeviceKeys,
  randomUuid,
  restoreDeviceKeys,
  toBase64url,
  type DeviceKeys,
} from '@bargu/crypto';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import { timed } from '../location/probe';

const STORAGE_KEY = 'bargu.device.v1';

/**
 * Keychain / Keystore item readable after the first unlock (background location and the iOS
 * notification extension run while the phone is locked), never synced or restored to another
 * device (BARGU_PLAN §3.1). Faz 7 adds the keychain access group shared with the extension.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

const storedSchema = z
  .object({
    deviceId: z.uuid(),
    identitySecretKey: z.string().length(43),
    dhSecretKey: z.string().length(43),
  })
  .strict();

/** Only the two 32-byte secrets are stored; public keys and signatures are recomputed. */
export async function loadDeviceKeys(): Promise<DeviceKeys | null> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS);
  if (raw === null) return null;
  const stored = storedSchema.parse(JSON.parse(raw));
  // The public keys are recomputed in JavaScript every start (reference curve code, slow on
  // Hermes, docs/ADR/0007): named for the stall meter.
  return timed('auth.restoreKeys', () =>
    restoreDeviceKeys({
      deviceId: stored.deviceId,
      identitySecretKey: fromBase64url(stored.identitySecretKey, 32),
      dhSecretKey: fromBase64url(stored.dhSecretKey, 32),
    }),
  );
}

/** A fresh device identity, persisted before it is used (a new id each time: ids never return). */
export async function createDeviceKeys(): Promise<DeviceKeys> {
  const keys = generateDeviceKeys(randomUuid());
  const stored: z.infer<typeof storedSchema> = {
    deviceId: keys.deviceId,
    identitySecretKey: toBase64url(keys.identity.secretKey),
    dhSecretKey: toBase64url(keys.dh.secretKey),
  };
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(stored), OPTIONS);
  return keys;
}

/** Logout or a revoked device: the keys are destroyed, the next login creates new ones. */
export async function deleteDeviceKeys(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY, OPTIONS);
}
