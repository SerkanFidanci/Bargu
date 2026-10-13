import { hexToBytes } from '@noble/hashes/utils.js';
import type { Payload } from '@bargu/schemas';

import { restoreDeviceKeys, type DeviceKeys, type DevicePublicKeys } from '../src/keys.js';

export const ids = {
  circle: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  otherCircle: '0190f7a4-5b6c-7d8e-9f01-23456789abce',
  aliceDevice: '0190f7a4-0000-7000-8000-00000000a11c',
  bobDevice: '0190f7a4-0000-7000-8000-000000000b0b',
  carolDevice: '0190f7a4-0000-7000-8000-0000000ca201',
  aliceUser: '0190f7a4-1111-7111-8111-00000000a11c',
  bobUser: '0190f7a4-1111-7111-8111-000000000b0b',
  place: '0190f7a4-2222-7222-8222-000000000001',
} as const;

/** Deterministic test-only device keys (never use fixed secrets outside tests). */
export function testDevice(deviceId: string, seedByte: number): DeviceKeys {
  return restoreDeviceKeys({
    deviceId,
    identitySecretKey: new Uint8Array(32).fill(seedByte),
    dhSecretKey: new Uint8Array(32).fill(seedByte + 1),
  });
}

export function publicKeysOf(device: DeviceKeys): DevicePublicKeys {
  return {
    deviceId: device.deviceId,
    identityKey: device.identity.publicKey,
    dhKey: device.dh.publicKey,
  };
}

export const hex = (text: string) => hexToBytes(text.replace(/\s+/g, ''));

export const locationPayload: Payload = {
  kind: 'loc',
  lat: 41.0082,
  lng: 28.9784,
  acc: 8,
  spd: 1.2,
  hdg: 270,
  bat: 64,
  chg: true,
  ts: 1_791_880_000_000,
};
