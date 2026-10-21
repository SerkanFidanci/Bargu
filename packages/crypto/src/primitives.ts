// Thin, audited-library-only wrappers (@noble/*). No primitive is implemented here. On a phone the
// curve operations may run natively (CryptoKit / Tink) after a self-test; see native.ts.
import { chacha20poly1305, xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
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

/** HMAC-SHA256 (RFC 2104) over `label || message`. */
export function hmacWithLabel(key: Uint8Array, label: Label, message: Uint8Array): Uint8Array {
  return hmac(sha256, key, concatBytes(labelBytes(label), message));
}

/** XChaCha20-Poly1305: 24-byte nonces are safe to pick at random (server-side data at rest). */
export function xaeadSeal(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  return xchacha20poly1305(key, nonce, aad).encrypt(plaintext);
}

export function xaeadOpen(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Uint8Array {
  try {
    return xchacha20poly1305(key, nonce, aad).decrypt(ciphertext);
  } catch {
    throw new BarguCryptoError('DECRYPT_FAILED', 'authentication failed');
  }
}

export interface KeyAndNonce {
  key: Uint8Array;
  nonce: Uint8Array;
}

/** HKDF-SHA256 (RFC 5869): `length` bytes from `ikm`, bound to `salt` and `info`. */
export function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: Uint8Array,
  length: number,
): Uint8Array {
  return hkdf(sha256, ikm, salt, info, length);
}

/** HKDF-SHA256 (RFC 5869) expanded to a ChaCha20-Poly1305 key and nonce. */
export function deriveKeyAndNonce(
  ikm: Uint8Array,
  salt: Uint8Array,
  label: Label,
  context: Uint8Array,
): KeyAndNonce {
  const okm = hkdfSha256(
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

/**
 * The curve operations a platform can provide natively. Pure-JS curve arithmetic needs BigInt,
 * which is slow on Hermes (Faz 1 device benchmark: 6.7 ms per signature); everything else (hashes,
 * HKDF, ChaCha20-Poly1305) stays in JS. Installed only through `installNativePrimitives`.
 */
export interface NativeCurvePrimitives {
  ed25519Sign(secretKey: Uint8Array, message: Uint8Array): Uint8Array;
  ed25519Verify(publicKey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean;
  x25519PublicKey(secretKey: Uint8Array): Uint8Array;
  x25519SharedSecret(secretKey: Uint8Array, publicKey: Uint8Array): Uint8Array;
}

let native: NativeCurvePrimitives | null = null;

/** @internal Only native.ts sets this, after the self-test passed. */
export function setNativeCurvePrimitives(primitives: NativeCurvePrimitives | null): void {
  native = primitives;
}

export function nativeCurvePrimitivesActive(): boolean {
  return native !== null;
}

/** Ed25519 (RFC 8032) signature over `label || message`. */
export function signWithLabel(
  label: Label,
  message: Uint8Array,
  identitySecretKey: Uint8Array,
): Uint8Array {
  const data = concatBytes(labelBytes(label), message);
  if (native === null) return ed25519.sign(data, identitySecretKey);
  const signature = native.ed25519Sign(identitySecretKey, data);
  if (signature.length !== SIGNATURE_BYTES) {
    throw new BarguCryptoError('INVALID_KEY', 'native signer returned a malformed signature');
  }
  return signature;
}

/**
 * Strict RFC 8032 verification (`zip215: false`): rejects non-canonical encodings and malleable
 * signatures. Apple CryptoKit verifies cofactorless and does not reject small-order keys, so the
 * two sides agree only on keys that passed `isValidEd25519PublicKey` (every identity key is
 * checked on registration). With the lengths checked here, noble only throws on non-byte
 * arguments, so invalid keys or signatures yield `false`.
 */
export function verifyWithLabel(
  label: Label,
  message: Uint8Array,
  signature: Uint8Array,
  identityPublicKey: Uint8Array,
): boolean {
  if (signature.length !== SIGNATURE_BYTES || identityPublicKey.length !== KEY_BYTES) return false;
  const data = concatBytes(labelBytes(label), message);
  if (native === null) {
    return ed25519.verify(signature, data, identityPublicKey, { zip215: false });
  }
  try {
    return native.ed25519Verify(identityPublicKey, data, signature);
  } catch {
    return false;
  }
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
  return native === null ? x25519.getPublicKey(secretKey) : native.x25519PublicKey(secretKey);
}

/** X25519 (RFC 7748). Low-order peer keys (all-zero shared secret) are rejected. */
export function x25519SharedSecret(secretKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  let shared: Uint8Array;
  try {
    shared =
      native === null
        ? x25519.getSharedSecret(secretKey, peerPublicKey)
        : native.x25519SharedSecret(secretKey, peerPublicKey);
  } catch {
    throw new BarguCryptoError('INVALID_KEY', 'unusable X25519 public key');
  }
  // noble already refuses this; a native implementation might not.
  if (shared.length !== KEY_BYTES || shared.every((byte) => byte === 0)) {
    throw new BarguCryptoError('INVALID_KEY', 'unusable X25519 public key');
  }
  return shared;
}
