import { type DeviceKeys, toBase64url } from '@bargu/crypto';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import type { Mutes } from './mutes';
import type { PushContacts } from './push-contacts';

/**
 * What the iOS Notification Service Extension needs to open and word a sealed notification
 * (docs/ADR/0016, apps/mobile/targets/notification-service): this device's id and X25519 secret
 * (never the identity key), the trusted contacts and the mutes. Kept in a keychain group only the
 * app and its extension share, readable after the first unlock, never synced. Off until the
 * Apple team id is configured (app.config.ts `extra.iosPushKeychainGroup`).
 */
export const EXTENSION_SERVICE = 'bargu.push';
export const EXTENSION_ITEMS = { device: 'device', contacts: 'contacts', mutes: 'mutes' } as const;

function options(): SecureStore.SecureStoreOptions | null {
  const extra: unknown = Constants.expoConfig?.extra;
  const group =
    typeof extra === 'object' && extra !== null && 'iosPushKeychainGroup' in extra
      ? extra.iosPushKeychainGroup
      : null;
  if (Platform.OS !== 'ios' || typeof group !== 'string') return null;
  return {
    keychainService: EXTENSION_SERVICE,
    accessGroup: group,
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  };
}

async function put(item: string, value: unknown): Promise<void> {
  const shared = options();
  if (shared !== null) await SecureStore.setItemAsync(item, JSON.stringify(value), shared);
}

export function shareWithExtension(contacts: PushContacts): Promise<void> {
  return put(EXTENSION_ITEMS.contacts, contacts);
}

export function shareMutesWithExtension(mutes: Mutes): Promise<void> {
  return put(EXTENSION_ITEMS.mutes, mutes);
}

export function shareDeviceWithExtension(device: DeviceKeys): Promise<void> {
  return put(EXTENSION_ITEMS.device, {
    deviceId: device.deviceId,
    dhSecretKey: toBase64url(device.dh.secretKey),
  });
}

/** Sign-out: the extension can open nothing any more. */
export async function clearExtensionShare(): Promise<void> {
  const shared = options();
  if (shared === null) return;
  for (const item of Object.values(EXTENSION_ITEMS)) {
    await SecureStore.deleteItemAsync(item, shared);
  }
}
