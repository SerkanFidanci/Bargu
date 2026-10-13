import { KEY_BYTES, LABELS, PROTOCOL_VERSION, TAG_BYTES } from './constants.js';
import { concatBytes, fromBase64url, labelBytes, toBase64url } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import { randomBytes, xaeadOpen, xaeadSeal } from './primitives.js';

const NONCE_BYTES = 24;
const HEADER_BYTES = 1 + NONCE_BYTES;

function additionalData(context: string): Uint8Array {
  return concatBytes(labelBytes(LABELS.atRest), labelBytes(context));
}

/**
 * Server-side encryption of short-lived sensitive data at rest, e.g. an email address inside a
 * queued job. XChaCha20-Poly1305 with a random 24-byte nonce; `context` names the purpose and is
 * authenticated, so a blob sealed for one purpose cannot be opened as another.
 * Output: version(1) ‖ nonce(24) ‖ ciphertext ‖ tag, base64url.
 */
export function sealAtRest(key: Uint8Array, plaintext: Uint8Array, context: string): string {
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
  const nonce = randomBytes(NONCE_BYTES);
  const ciphertext = xaeadSeal(key, nonce, plaintext, additionalData(context));
  return toBase64url(concatBytes(Uint8Array.of(PROTOCOL_VERSION), nonce, ciphertext));
}

export function openAtRest(key: Uint8Array, sealed: string, context: string): Uint8Array {
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
  const bytes = fromBase64url(sealed);
  if (bytes.length < HEADER_BYTES + TAG_BYTES || bytes[0] !== PROTOCOL_VERSION) {
    throw new BarguCryptoError('MALFORMED', 'invalid sealed data');
  }
  return xaeadOpen(
    key,
    bytes.subarray(1, HEADER_BYTES),
    bytes.subarray(HEADER_BYTES),
    additionalData(context),
  );
}
