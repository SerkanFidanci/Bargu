import {
  KEY_BYTES,
  LABELS,
  MAX_PUSH_PADDED_BYTES,
  PROTOCOL_VERSION,
  PUSH_PADDING_BLOCK_BYTES,
  TAG_BYTES,
} from './constants.js';
import { concatBytes, fromBase64url, toBase64url } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import type { DeviceKeys } from './keys.js';
import { pad, unpad } from './padding.js';
import {
  aeadOpen,
  aeadSeal,
  deriveKeyAndNonce,
  randomBytes,
  x25519PublicKey,
  x25519SharedSecret,
} from './primitives.js';

const HEADER_BYTES = 1 + KEY_BYTES;

function sealKey(sharedSecret: Uint8Array, ephemeralKey: Uint8Array, recipientDhKey: Uint8Array) {
  return deriveKeyAndNonce(
    sharedSecret,
    concatBytes(ephemeralKey, recipientDhKey),
    LABELS.pushKdf,
    new Uint8Array(0),
  );
}

/** @internal Deterministic core; the ephemeral secret must be fresh randomness in production. */
export function sealForDeviceWith(
  recipientDhKey: Uint8Array,
  plaintext: Uint8Array,
  ephemeralSecretKey: Uint8Array,
): string {
  const ephemeralKey = x25519PublicKey(ephemeralSecretKey);
  const header = concatBytes(Uint8Array.of(PROTOCOL_VERSION), ephemeralKey);
  const sharedSecret = x25519SharedSecret(ephemeralSecretKey, recipientDhKey);
  const keyAndNonce = sealKey(sharedSecret, ephemeralKey, recipientDhKey);
  sharedSecret.fill(0);
  const ct = aeadSeal(
    keyAndNonce,
    pad(plaintext, PUSH_PADDING_BLOCK_BYTES, MAX_PUSH_PADDED_BYTES),
    header,
  );
  keyAndNonce.key.fill(0);
  return toBase64url(concatBytes(header, ct));
}

/**
 * Anonymous sealed box for one device (push payloads): X25519 with a fresh ephemeral key,
 * HKDF-SHA256, ChaCha20-Poly1305. Output: version(1) ‖ ephemeralKey(32) ‖ ciphertext ‖ tag,
 * base64url. Openable by the iOS Notification Service Extension with CryptoKit alone. The sealed
 * box hides the content; authenticity comes from the signed envelope placed inside it.
 */
export function sealForDevice(recipientDhKey: Uint8Array, plaintext: Uint8Array): string {
  const ephemeralSecretKey = randomBytes(KEY_BYTES);
  try {
    return sealForDeviceWith(recipientDhKey, plaintext, ephemeralSecretKey);
  } finally {
    ephemeralSecretKey.fill(0);
  }
}

export function openSealed(recipient: DeviceKeys, sealed: string): Uint8Array {
  const bytes = fromBase64url(sealed);
  if (bytes.length < HEADER_BYTES + TAG_BYTES || bytes[0] !== PROTOCOL_VERSION) {
    throw new BarguCryptoError('MALFORMED', 'invalid sealed box');
  }
  const header = bytes.subarray(0, HEADER_BYTES);
  const ephemeralKey = bytes.slice(1, HEADER_BYTES);
  const sharedSecret = x25519SharedSecret(recipient.dh.secretKey, ephemeralKey);
  const keyAndNonce = sealKey(sharedSecret, ephemeralKey, recipient.dh.publicKey);
  sharedSecret.fill(0);
  try {
    return unpad(
      aeadOpen(keyAndNonce, bytes.subarray(HEADER_BYTES), header),
      PUSH_PADDING_BLOCK_BYTES,
    );
  } finally {
    keyAndNonce.key.fill(0);
  }
}
