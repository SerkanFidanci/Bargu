import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { fromBase64url, toBase64url, utf8Encode } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { openSealed, sealForDevice } from '../src/sealed.js';
import { ids, testDevice } from './helpers.js';

const bob = testDevice(ids.bobDevice, 3);
const carol = testDevice(ids.carolDevice, 5);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('sealed push payloads', () => {
  it('round-trips arbitrary bytes for the recipient device (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1500 }), (plaintext) => {
        expect(openSealed(bob, sealForDevice(bob.dh.publicKey, plaintext))).toEqual(plaintext);
      }),
      { numRuns: 100 },
    );
  });

  it('pads to 128-byte blocks and uses a fresh ephemeral key each time', () => {
    const a = sealForDevice(bob.dh.publicKey, utf8Encode('hi'));
    const b = sealForDevice(bob.dh.publicKey, utf8Encode('hi'));
    expect(a).not.toBe(b);
    expect(fromBase64url(a).length).toBe(1 + 32 + 128 + 16);
  });

  it('cannot be opened by another device or after tampering', () => {
    const sealed = sealForDevice(bob.dh.publicKey, utf8Encode('secret'));
    expect(codeOf(() => openSealed(carol, sealed))).toBe('DECRYPT_FAILED');

    const bytes = fromBase64url(sealed);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(codeOf(() => openSealed(bob, toBase64url(bytes)))).toBe('DECRYPT_FAILED');
  });

  it('rejects malformed boxes and unusable keys', () => {
    expect(codeOf(() => openSealed(bob, '***'))).toBe('MALFORMED');
    expect(codeOf(() => openSealed(bob, toBase64url(new Uint8Array(40))))).toBe('MALFORMED');
    const wrongVersion = fromBase64url(sealForDevice(bob.dh.publicKey, utf8Encode('x')));
    wrongVersion[0] = 2;
    expect(codeOf(() => openSealed(bob, toBase64url(wrongVersion)))).toBe('MALFORMED');
    expect(codeOf(() => sealForDevice(new Uint8Array(32), utf8Encode('x')))).toBe('INVALID_KEY');
    expect(codeOf(() => sealForDevice(bob.dh.publicKey, new Uint8Array(2048)))).toBe(
      'PAYLOAD_TOO_LARGE',
    );
  });
});
