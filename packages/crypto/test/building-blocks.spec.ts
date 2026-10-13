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
import { REPLAY_WINDOW, ReplayGuard } from '../src/replay.js';
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
        const padded = pad(data, 128, 1024);
        expect(padded.length % 128).toBe(0);
        expect(padded.length).toBeGreaterThan(data.length);
        expect(unpad(padded, 128)).toEqual(data);
      }),
    );
  });

  it('gives every input the same size when the block is the limit (property)', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 511 }), (data) => {
        const padded = pad(data, 512, 512);
        expect(padded).toHaveLength(512);
        expect(unpad(padded, 512)).toEqual(data);
      }),
    );
  });

  it('rejects oversized input and invalid padding', () => {
    expect(codeOf(() => pad(new Uint8Array(1024), 128, 1024))).toBe('PAYLOAD_TOO_LARGE');
    expect(codeOf(() => pad(new Uint8Array(512), 512, 512))).toBe('PAYLOAD_TOO_LARGE');
    for (const bad of [
      new Uint8Array(0),
      new Uint8Array(100),
      new Uint8Array(128),
      Uint8Array.of(...new Array<number>(127).fill(0), 7),
    ]) {
      expect(codeOf(() => unpad(bad, 128))).toBe('DECRYPT_FAILED');
    }
    expect(codeOf(() => unpad(pad(Uint8Array.of(1), 128, 1024), 512))).toBe('DECRYPT_FAILED');
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
  const { circle, aliceDevice: alice, bobDevice: bob } = ids;
  const { otherCircle } = ids;

  it('accepts each sequence number once and tells latest from reordered', () => {
    const guard = new ReplayGuard();
    expect(guard.check(circle, alice, 1, 0)).toBe('latest');
    guard.accept(circle, alice, 1, 5);
    expect(guard.check(circle, alice, 1, 5)).toBe('replay');
    expect(guard.check(circle, alice, 1, 6)).toBe('latest');
    expect(guard.check(circle, alice, 1, 3)).toBe('reordered');
    guard.accept(circle, alice, 1, 3);
    expect(guard.check(circle, alice, 1, 3)).toBe('replay');
    guard.accept(circle, alice, 1, 3); // a replay is never recorded twice
    expect(guard.toJSON()[`${circle}/${alice}`]?.epochs['1']?.seen).toEqual([3]);
    expect(guard.check(circle, bob, 1, 0)).toBe('latest');
  });

  it('keeps circles apart: epochs and sequence numbers are per circle', () => {
    const guard = new ReplayGuard();
    guard.accept(circle, alice, 1, 5);
    // Alice's first message in another circle at the same epoch is not a replay.
    expect(guard.check(otherCircle, alice, 1, 0)).toBe('latest');
    guard.accept(otherCircle, alice, 1, 7);
    // A newer epoch in one circle must not clear the other circle's current window.
    guard.accept(circle, alice, 3, 0);
    expect(guard.check(otherCircle, alice, 1, 7)).toBe('replay');
  });

  it('accepts out-of-order messages inside the window only', () => {
    const guard = new ReplayGuard();
    guard.accept(circle, alice, 1, 100);
    expect(guard.check(circle, alice, 1, 100 - REPLAY_WINDOW + 1)).toBe('reordered');
    expect(guard.check(circle, alice, 1, 100 - REPLAY_WINDOW)).toBe('replay');
    guard.accept(circle, alice, 1, 99);
    guard.accept(circle, alice, 1, 100 + REPLAY_WINDOW - 1);
    // Sliding forward drops numbers that left the window and keeps the ones still inside.
    const window = guard.toJSON()[`${circle}/${alice}`]?.epochs['1'];
    expect(window).toEqual({ max: 100 + REPLAY_WINDOW - 1, seen: [100] });
    expect(guard.check(circle, alice, 1, 99)).toBe('replay');
  });

  it('keeps an epoch floor: two epochs back is dead even if its key is still stored', () => {
    const guard = new ReplayGuard();
    guard.accept(circle, alice, 1, 0);
    guard.accept(circle, alice, 2, 0);
    expect(guard.check(circle, alice, 1, 1)).toBe('reordered'); // previous epoch, in flight
    expect(guard.check(circle, alice, 2, 1)).toBe('latest');
    guard.accept(circle, alice, 3, 0);
    expect(guard.check(circle, alice, 1, 1)).toBe('replay');
    expect(guard.check(circle, alice, 2, 5)).toBe('reordered');
    expect(Object.keys(guard.toJSON()[`${circle}/${alice}`]?.epochs ?? {})).toEqual(['2', '3']);
    // First message seen from the previous epoch after a newer one: accepted, but not latest.
    guard.accept(circle, bob, 5, 0);
    expect(guard.check(circle, bob, 4, 9)).toBe('reordered');
    guard.accept(circle, bob, 4, 9);
    expect(guard.check(circle, bob, 4, 9)).toBe('replay');
  });

  it('survives a restart through its serialised state, without sharing it', () => {
    const guard = new ReplayGuard();
    guard.accept(circle, alice, 1, 9);
    const state = guard.toJSON();
    const restored = new ReplayGuard(state);
    expect(restored.check(circle, alice, 1, 9)).toBe('replay');
    restored.accept(circle, alice, 1, 10);
    expect(state[`${circle}/${alice}`]?.epochs['1']?.max).toBe(9);
    expect(guard.check(circle, alice, 1, 10)).toBe('latest');
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
