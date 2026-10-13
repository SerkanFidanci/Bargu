// Thin, audited-library-only wrappers (@noble/*). No primitive is implemented here.
import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { randomBytes as cryptoRandomBytes } from '@noble/hashes/utils.js';

import { KEY_BYTES, NONCE_BYTES, SIGNATURE_BYTES, type Label } from './constants.js';
import { concatBytes, labelBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';

/**
 * Cryptographically secure random bytes from `crypto.getRandomValues`. Throws when the runtime has
 * no CSPRNG; React Native installs one from expo-crypto at startup.
 */
export function randomBytes(length: number): Uint8Array {
  return cryptoRandomBytes(length);
}

export function sha256Hash(data: Uint8Array): Uint8Array {
  return sha256(data);
}

export interface KeyAndNonce {
  key: Uint8Array;
  nonce: Uint8Array;
}

/** HKDF-SHA256 (RFC 5869) expanded to a ChaCha20-Poly1305 key and nonce. */
export function deriveKeyAndNonce(
  ikm: Uint8Array,
  salt: Uint8Array,
  label: Label,
  context: Uint8Array,
): KeyAndNonce {
  const okm = hkdf(
    sha256,
    ikm,
    salt,
    concatBytes(labelBytes(label), context),
    KEY_BYTES + NONCE_BYTES,
  );
  const result = { key: okm.slice(0, KEY_BYTES), nonce: okm.slice(KEY_BYTES) };
  okm.fill(0);
  return result;
}

/** ChaCha20-Poly1305 (RFC 8439) encryption. */
export function aeadSeal(
  { key, nonce }: KeyAndNonce,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return chacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

/** ChaCha20-Poly1305 decryption; any authentication failure is a DECRYPT_FAILED error. */
export function aeadOpen(
  { key, nonce }: KeyAndNonce,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  try {
    return chacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    throw new BarguCryptoError('DECRYPT_FAILED', 'authentication failed');
  }
}

/** Ed25519 (RFC 8032) signature over `label || message`. */
export function signWithLabel(
  label: Label,
  message: Uint8Array,
  identitySecretKey: Uint8Array,
): Uint8Array {
  return ed25519.sign(concatBytes(labelBytes(label), message), identitySecretKey);
}

/**
 * Strict RFC 8032 verification (`zip215: false`): rejects non-canonical encodings and malleable
 * signatures, matching Apple CryptoKit. With the lengths checked here, noble only throws on
 * non-byte arguments, so invalid keys or signatures yield `false`.
 */
export function verifyWithLabel(
  label: Label,
  message: Uint8Array,
  signature: Uint8Array,
  identityPublicKey: Uint8Array,
): boolean {
  if (signature.length !== SIGNATURE_BYTES || identityPublicKey.length !== KEY_BYTES) return false;
  return ed25519.verify(signature, concatBytes(labelBytes(label), message), identityPublicKey, {
    zip215: false,
  });
}

export function ed25519PublicKey(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

/** A canonical, prime-order-subgroup Ed25519 point (small-order "weak" keys are rejected). */
export function isValidEd25519PublicKey(publicKey: Uint8Array): boolean {
  if (publicKey.length !== KEY_BYTES || !ed25519.utils.isValidPublicKey(publicKey, false)) {
    return false;
  }
  return !ed25519.Point.fromBytes(publicKey, false).isSmallOrder();
}

export function x25519PublicKey(secretKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(secretKey);
}

/** X25519 (RFC 7748). Low-order peer keys (all-zero shared secret) are rejected. */
export function x25519SharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  try {
    return x25519.getSharedSecret(secretKey, peerPublicKey);
  } catch {
    throw new BarguCryptoError('INVALID_KEY', 'unusable X25519 public key');
  }
}
