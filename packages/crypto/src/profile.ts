import { KEY_BYTES, LABELS, PROTOCOL_VERSION, TAG_BYTES } from './constants.js';
import { concatBytes, labelBytes, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import { randomBytes, xaeadOpen, xaeadSeal } from './primitives.js';

const NONCE_BYTES = 24;
const HEADER_BYTES = 1 + NONCE_BYTES;
/** A profile photo after resizing on the phone (bytes, before sealing; request bodies are ≤ 64 KB). */
export const MAX_PHOTO_BYTES = 40 * 1024;

/** A fresh key for one profile photo; it reaches the user's circles inside encrypted messages. */
export function generatePhotoKey(): Uint8Array {
  return randomBytes(KEY_BYTES);
}

function additionalData(photoId: string): Uint8Array {
  return concatBytes(labelBytes(LABELS.profilePhoto), uuidToBytes(photoId));
}

/**
 * Encrypts a profile photo for upload (docs/ADR/0014): XChaCha20-Poly1305 with a random nonce and
 * the photo id authenticated, so the server cannot pass one photo off as another.
 * Output: version(1) ‖ nonce(24) ‖ ciphertext ‖ tag.
 */
export function sealProfilePhoto(key: Uint8Array, photoId: string, image: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
  if (image.length === 0 || image.length > MAX_PHOTO_BYTES) {
    throw new BarguCryptoError('MALFORMED', 'photo too large or empty');
  }
  const nonce = randomBytes(NONCE_BYTES);
  return concatBytes(
    Uint8Array.of(PROTOCOL_VERSION),
    nonce,
    xaeadSeal(key, nonce, image, additionalData(photoId)),
  );
}

/** Opens a downloaded photo with the key its owner shared; throws if anything was changed. */
export function openProfilePhoto(key: Uint8Array, photoId: string, sealed: Uint8Array): Uint8Array {
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
  if (sealed.length < HEADER_BYTES + TAG_BYTES || sealed[0] !== PROTOCOL_VERSION) {
    throw new BarguCryptoError('MALFORMED', 'invalid sealed photo');
  }
  return xaeadOpen(
    key,
    sealed.subarray(1, HEADER_BYTES),
    sealed.subarray(HEADER_BYTES),
    additionalData(photoId),
  );
}
