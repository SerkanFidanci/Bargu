import { createHash, createPublicKey, type JsonWebKey } from 'node:crypto';

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fromBase64url } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import {
  bytesEqual,
  randomUuid,
  sha256,
  signingKeyFromSeed,
  verificationKeyFromRaw,
} from '../src/server.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('server helpers', () => {
  it('hash with SHA-256', () => {
    const data = new TextEncoder().encode('bargu');
    expect(Buffer.from(sha256(data))).toEqual(createHash('sha256').update(data).digest());
  });

  it('compare bytes', () => {
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 2))).toBe(true);
    expect(bytesEqual(Uint8Array.of(1, 2), Uint8Array.of(1, 3))).toBe(false);
    expect(bytesEqual(Uint8Array.of(1), Uint8Array.of(1, 2))).toBe(false);
  });

  it('generate canonical version-4 UUIDs (property)', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        expect(randomUuid()).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
      }),
      { numRuns: 200 },
    );
    expect(randomUuid()).not.toBe(randomUuid());
  });

  it('turn a seed into Ed25519 JWKs that Node accepts', () => {
    const key = signingKeyFromSeed(new Uint8Array(32).fill(9));
    const jwk = JSON.parse(JSON.stringify(key.publicJwk)) as JsonWebKey;
    const publicKey = createPublicKey({ key: jwk, format: 'jwk' });
    expect(publicKey.asymmetricKeyType).toBe('ed25519');
    expect(key.privateJwk.x).toBe(key.publicJwk.x);
    expect(key.keyId).toHaveLength(16);
    const previous = verificationKeyFromRaw(fromBase64url(key.publicJwk.x));
    expect(previous.keyId).toBe(key.keyId);
    expect(previous.publicJwk).toEqual(key.publicJwk);
  });

  it('reject bad key material', () => {
    expect(codeOf(() => signingKeyFromSeed(new Uint8Array(31)))).toBe('INVALID_KEY');
    expect(codeOf(() => verificationKeyFromRaw(new Uint8Array(32)))).toBe('INVALID_KEY');
  });
});
