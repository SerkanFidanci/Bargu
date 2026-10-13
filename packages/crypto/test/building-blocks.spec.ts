import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { REKEY_INTERVAL_MS } from '../src/constants.js';
import {
  fromBase64url,
  labelBytes,
  toBase64url,
  u32be,
  utf8Decode,
  uuidToBytes,
} from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { pad, unpad } from '../src/padding.js';
import {
  deriveKeyAndNonce,
  isValidEd25519PublicKey,
  randomBytes,
  verifyWithLabel,
  x25519SharedSecret,
} from '../src/primitives.js';
import { rekeyReason } from '../src/rekey.js';
import { ReplayGuard } from '../src/replay.js';
import { ids } from './helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

describe('encoding', () => {
  it('round-trips base64url and rejects non-canonical or invalid text', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 200 }), (bytes) => {
        expect(fromBase64url(toBase64url(bytes))).toEqual(bytes);
      }),
    );
    expect(codeOf(() => fromBase64url('AB'))).toBe('MALFORMED'); // non-zero trailing bits
    expect(codeOf(() => fromBase64url('AA=='))).toBe('MALFORMED'); // padding not allowed
    expect(codeOf(() => fromBase64url('A+'))).toBe('MALFORMED'); // standard alphabet
    expect(codeOf(() => fromBase64url('AAAA', 4))).toBe('MALFORMED'); // wrong length
  });

  it('accepts only canonical UUIDs', () => {
    expect(uuidToBytes(ids.circle)).toHaveLength(16);
    expect(codeOf(() => uuidToBytes(ids.circle.toUpperCase()))).toBe('MALFORMED');
    expect(codeOf(() => uuidToBytes('0190f7a45b6c7d8e9f0123456789abcd'))).toBe('MALFORMED');
  });

  it('encodes u32 big-endian and rejects out-of-range values', () => {
    expect([...u32be(0x01020304)]).toEqual([1, 2, 3, 4]);
    for (const bad of [-1, 2 ** 32, 1.5, Number.NaN]) {
      expect(codeOf(() => u32be(bad))).toBe('MALFORMED');
    }
  });

  it('terminates labels so none is a prefix of another', () => {
    expect([...labelBytes('ab')]).toEqual([0x61, 0x62, 0x00]);
  });

  it('rejects invalid UTF-8', () => {
    expect(codeOf(() => utf8Decode(Uint8Array.of(0xc3, 0x28)))).toBe('MALFORMED');
  });
});

describe('padding', () => {
  it('round-trips and always fills whole blocks (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1023 }), (data) => {
        const padded = pad(data, 1024);
        expect(padded.length % 128).toBe(0);
        expect(padded.length).toBeGreaterThan(data.length);
        expect(unpad(padded)).toEqual(data);
      }),
    );
  });

  it('rejects oversized input and invalid padding', () => {
    expect(codeOf(() => pad(new Uint8Array(1024), 1024))).toBe('PAYLOAD_TOO_LARGE');
    for (const bad of [
      new Uint8Array(0),
      new Uint8Array(100),
      new Uint8Array(128),
      Uint8Array.of(...new Array<number>(127).fill(0), 7),
    ]) {
      expect(codeOf(() => unpad(bad))).toBe('DECRYPT_FAILED');
    }
  });
});

describe('primitives', () => {
  it('derives independent keys per label and context', () => {
    const ikm = new Uint8Array(32).fill(1);
    const salt = new Uint8Array(16);
    const a = deriveKeyAndNonce(ikm, salt, 'bargu/v1/msg', Uint8Array.of(1));
    const b = deriveKeyAndNonce(ikm, salt, 'bargu/v1/msg', Uint8Array.of(2));
    const c = deriveKeyAndNonce(ikm, salt, 'bargu/v1/push', Uint8Array.of(1));
    expect(a.key).toHaveLength(32);
    expect(a.nonce).toHaveLength(12);
    expect(a.key).not.toEqual(b.key);
    expect(a.key).not.toEqual(c.key);
    expect(deriveKeyAndNonce(ikm, salt, 'bargu/v1/msg', Uint8Array.of(1))).toEqual(a);
  });

  it('returns fresh randomness of the requested size', () => {
    expect(randomBytes(32)).toHaveLength(32);
    expect(randomBytes(32)).not.toEqual(randomBytes(32));
  });

  it('rejects low-order X25519 keys and malformed signatures', () => {
    expect(codeOf(() => x25519SharedSecret(new Uint8Array(32).fill(1), new Uint8Array(32)))).toBe(
      'INVALID_KEY',
    );
    expect(
      verifyWithLabel('bargu/v1/msg-sig', Uint8Array.of(1), new Uint8Array(63), new Uint8Array(32)),
    ).toBe(false);
    expect(
      verifyWithLabel('bargu/v1/msg-sig', Uint8Array.of(1), new Uint8Array(64), new Uint8Array(31)),
    ).toBe(false);
    expect(isValidEd25519PublicKey(new Uint8Array(31))).toBe(false);
  });
});

describe('ReplayGuard', () => {
  it('tracks the highest sequence per sender and epoch', () => {
    const guard = new ReplayGuard();
    expect(guard.isFresh(ids.aliceDevice, 1, 0)).toBe(true);
    guard.accept(ids.aliceDevice, 1, 5);
    guard.accept(ids.aliceDevice, 1, 3); // stale: ignored
    expect(guard.isFresh(ids.aliceDevice, 1, 5)).toBe(false);
    expect(guard.isFresh(ids.aliceDevice, 1, 6)).toBe(true);
    expect(guard.isFresh(ids.bobDevice, 1, 0)).toBe(true);
    expect(guard.isFresh(ids.aliceDevice, 2, 0)).toBe(true);
  });

  it('survives a restart through its serialised state', () => {
    const guard = new ReplayGuard();
    guard.accept(ids.aliceDevice, 1, 9);
    const restored = new ReplayGuard(guard.toJSON());
    expect(restored.isFresh(ids.aliceDevice, 1, 9)).toBe(false);
  });

  it('forgets epochs older than the previous one', () => {
    const guard = new ReplayGuard();
    guard.accept(ids.aliceDevice, 1, 9);
    guard.accept(ids.bobDevice, 1, 9);
    guard.accept(ids.aliceDevice, 2, 1);
    expect(Object.keys(guard.toJSON())).toHaveLength(3);
    guard.accept(ids.aliceDevice, 3, 1);
    expect(guard.toJSON()).not.toHaveProperty(`${ids.aliceDevice}/1`);
    expect(guard.toJSON()).toHaveProperty(`${ids.bobDevice}/1`);
  });
});

describe('rekeyReason', () => {
  const start = 1_000;
  it('requires a new epoch on membership or device change, lost state, or after 24 hours', () => {
    expect(rekeyReason({ epochStartedAt: start, now: start + 1 })).toBeNull();
    expect(rekeyReason({ epochStartedAt: start, now: start, membershipChanged: true })).toBe(
      'membership-changed',
    );
    expect(rekeyReason({ epochStartedAt: start, now: start, deviceChanged: true })).toBe(
      'device-changed',
    );
    expect(rekeyReason({ epochStartedAt: start, now: start, senderStateLost: true })).toBe(
      'state-lost',
    );
    expect(rekeyReason({ epochStartedAt: start, now: start + REKEY_INTERVAL_MS })).toBe(
      'interval-elapsed',
    );
  });
});
