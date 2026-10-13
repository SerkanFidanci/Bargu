import { deviceKeyBundleSchema, type DeviceKeyBundle } from '@bargu/schemas';

import { KEY_BYTES, LABELS } from './constants.js';
import { concatBytes, fromBase64url, toBase64url, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import {
  ed25519PublicKey,
  isValidEd25519PublicKey,
  randomBytes,
  signWithLabel,
  verifyWithLabel,
  x25519PublicKey,
} from './primitives.js';

export interface KeyPair {
  readonly publicKey: Uint8Array;
  readonly secretKey: Uint8Array;
}

/** A device's own key material. Secret keys never leave the device (SecureStore / Keychain). */
export interface DeviceKeys {
  readonly deviceId: string;
  /** Ed25519: signs envelopes, sender key distributions and the DH key. */
  readonly identity: KeyPair;
  /** X25519: receives sender keys and sealed push payloads. */
  readonly dh: KeyPair;
  /** Identity signature binding `dh.publicKey` to this device. */
  readonly dhKeySignature: Uint8Array;
}

/** Another device's public keys, after `verifyDeviceKeyBundle`. */
export interface DevicePublicKeys {
  readonly deviceId: string;
  readonly identityKey: Uint8Array;
  readonly dhKey: Uint8Array;
}

function dhKeyStatement(deviceId: string, dhPublicKey: Uint8Array): Uint8Array {
  return concatBytes(uuidToBytes(deviceId), dhPublicKey);
}

/**
 * Rebuilds a device's keys from its two stored 32-byte secrets. Public keys and the (deterministic)
 * DH key signature are recomputed, so only the secrets need secure storage.
 */
export function restoreDeviceKeys(input: {
  deviceId: string;
  identitySecretKey: Uint8Array;
  dhSecretKey: Uint8Array;
}): DeviceKeys {
  const { deviceId, identitySecretKey, dhSecretKey } = input;
  if (identitySecretKey.length !== KEY_BYTES || dhSecretKey.length !== KEY_BYTES) {
    throw new BarguCryptoError('INVALID_KEY', 'secret keys must be 32 bytes');
  }
  const identity = { publicKey: ed25519PublicKey(identitySecretKey), secretKey: identitySecretKey };
  const dh = { publicKey: x25519PublicKey(dhSecretKey), secretKey: dhSecretKey };
  const dhKeySignature = signWithLabel(
    LABELS.dhKeySignature,
    dhKeyStatement(deviceId, dh.publicKey),
    identitySecretKey,
  );
  return { deviceId, identity, dh, dhKeySignature };
}

/** Fresh identity (Ed25519) and DH (X25519) keys for a newly registered device. */
export function generateDeviceKeys(deviceId: string): DeviceKeys {
  return restoreDeviceKeys({
    deviceId,
    identitySecretKey: randomBytes(KEY_BYTES),
    dhSecretKey: randomBytes(KEY_BYTES),
  });
}

/** The public half a device uploads at registration. */
export function exportDeviceKeyBundle(keys: DeviceKeys): DeviceKeyBundle {
  return {
    deviceId: keys.deviceId,
    identityKey: toBase64url(keys.identity.publicKey),
    dhKey: toBase64url(keys.dh.publicKey),
    dhKeySignature: toBase64url(keys.dhKeySignature),
  };
}

/**
 * Validates a device bundle from the directory: well-formed, a valid identity key, and a DH key
 * signed by that identity for this device id. Trust in the identity key itself comes from safety
 * number verification; this check stops the server from swapping the DH key underneath it.
 */
export function verifyDeviceKeyBundle(bundle: unknown): DevicePublicKeys {
  const parsed = deviceKeyBundleSchema.safeParse(bundle);
  if (!parsed.success) throw new BarguCryptoError('MALFORMED', 'invalid device key bundle');
  const { deviceId } = parsed.data;
  const identityKey = fromBase64url(parsed.data.identityKey, KEY_BYTES);
  const dhKey = fromBase64url(parsed.data.dhKey, KEY_BYTES);
  const signature = fromBase64url(parsed.data.dhKeySignature);
  if (!isValidEd25519PublicKey(identityKey)) {
    throw new BarguCryptoError('INVALID_KEY', 'invalid identity key');
  }
  if (
    !verifyWithLabel(LABELS.dhKeySignature, dhKeyStatement(deviceId, dhKey), signature, identityKey)
  ) {
    throw new BarguCryptoError('BAD_SIGNATURE', 'DH key is not signed by the identity key');
  }
  return { deviceId, identityKey, dhKey };
}
