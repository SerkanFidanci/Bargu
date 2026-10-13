// Small building blocks the API needs, kept here so that no other package touches crypto APIs
// directly (CLAUDE.md). Portable: they run on Node and Hermes alike.
import { equalBytes } from '@noble/ciphers/utils.js';

import { KEY_BYTES } from './constants.js';
import { toBase64url } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import {
  ed25519PublicKey,
  isValidEd25519PublicKey,
  randomBytes,
  sha256Hash,
} from './primitives.js';

/** SHA-256. */
export function sha256(data: Uint8Array): Uint8Array {
  return sha256Hash(data);
}

/** Constant-time comparison of two byte strings. */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && equalBytes(a, b);
}

/** Random (version 4) UUID from the CSPRNG, canonical lower-case form. */
export function randomUuid(): string {
  // RFC 9562: version nibble 4 in byte 6, variant bits 10 in byte 8.
  const version = (byte: number, index: number) =>
    index === 6 ? (byte & 0x0f) | 0x40 : index === 8 ? (byte & 0x3f) | 0x80 : byte;
  const hex = Array.from(randomBytes(16), (byte, index) =>
    version(byte, index).toString(16).padStart(2, '0'),
  ).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface OkpJwk {
  kty: 'OKP';
  crv: 'Ed25519';
  x: string;
  d?: string;
}

/** Short identifier of an Ed25519 public key (JWT `kid`). */
function keyIdOf(publicKey: Uint8Array): string {
  return toBase64url(sha256Hash(publicKey)).slice(0, 16);
}

/**
 * The server's Ed25519 signing key (access tokens) from its 32-byte seed, as JWKs for the JOSE
 * library plus a key id derived from the public key.
 */
export function signingKeyFromSeed(seed: Uint8Array): {
  keyId: string;
  privateJwk: OkpJwk;
  publicJwk: OkpJwk;
} {
  if (seed.length !== KEY_BYTES)
    throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte seed');
  const publicKey = ed25519PublicKey(seed);
  const x = toBase64url(publicKey);
  return {
    keyId: keyIdOf(publicKey),
    privateJwk: { kty: 'OKP', crv: 'Ed25519', x, d: toBase64url(seed) },
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x },
  };
}

/** A raw Ed25519 public key (e.g. the previous signing key during rotation) as a JWK. */
export function verificationKeyFromRaw(publicKey: Uint8Array): {
  keyId: string;
  publicJwk: OkpJwk;
} {
  if (!isValidEd25519PublicKey(publicKey)) {
    throw new BarguCryptoError('INVALID_KEY', 'invalid Ed25519 public key');
  }
  return {
    keyId: keyIdOf(publicKey),
    publicJwk: { kty: 'OKP', crv: 'Ed25519', x: toBase64url(publicKey) },
  };
}
