import type { MessageEnvelope, Payload } from '@bargu/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_U32 } from '../src/constants.js';
import { fromBase64url, toBase64url, utf8Encode } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import {
  createSenderState,
  decryptMessage,
  encryptMessage,
  encryptPaddedWith,
  verifyMessageEnvelope,
  type SenderState,
} from '../src/message.js';
import { pad } from '../src/padding.js';
import { ReplayGuard } from '../src/replay.js';
import { generateSenderKey } from '../src/sender-key.js';
import { ids, locationPayload, publicKeysOf, testDevice } from './helpers.js';

const alice = testDevice(ids.aliceDevice, 1);
const bob = testDevice(ids.bobDevice, 3);
const senderKey = generateSenderKey({
  circleId: ids.circle,
  epoch: 2,
  senderDeviceId: ids.aliceDevice,
});
const aliceKeys = publicKeysOf(alice);

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

function decrypt(envelope: unknown, replay = new ReplayGuard()): Payload {
  return decryptMessage({ envelope, senderKey, sender: aliceKeys, replay });
}

// JSON has no negative zero (`-0` serialises as `0`, the same coordinate), so generate +0 only.
const coordinate = (min: number, max: number) =>
  fc.double({ min, max, noNaN: true }).map((value) => value + 0);

const locationArbitrary: fc.Arbitrary<Payload> = fc.record(
  {
    kind: fc.constant('loc' as const),
    lat: coordinate(-90, 90),
    lng: coordinate(-180, 180),
    acc: coordinate(0, 5000),
    spd: coordinate(0, 80),
    hdg: coordinate(0, 359.99),
    bat: fc.integer({ min: 0, max: 100 }),
    chg: fc.boolean(),
    ts: fc.integer({ min: 0, max: 4_102_444_800_000 }),
  },
  { requiredKeys: ['kind', 'lat', 'lng', 'acc', 'bat', 'chg', 'ts'] },
);

const statusArbitrary: fc.Arbitrary<Payload> = fc.record({
  kind: fc.constant('status' as const),
  text: fc.string({ minLength: 1, maxLength: 80, unit: 'grapheme' }),
  expiresAt: fc.nat(),
  ts: fc.nat(),
});

describe('encryptMessage / decryptMessage', () => {
  it('round-trips every payload kind', () => {
    let state: SenderState = createSenderState(senderKey);
    const replay = new ReplayGuard();
    for (const payload of [
      locationPayload,
      { kind: 'bump', ts: 1 },
      { kind: 'place_enter', placeId: ids.place, ts: 2 },
      { kind: 'place_exit', placeId: ids.place, ts: 3 },
      { kind: 'share_stop', ts: 4 },
      { kind: 'status', emoji: '🚲', text: 'Yoldayım', expiresAt: 9, ts: 5 },
    ] satisfies Payload[]) {
      const { envelope, nextState } = encryptMessage({ state, sender: alice, payload });
      expect(envelope.seq).toBe(state.nextSeq);
      expect(nextState.nextSeq).toBe(state.nextSeq + 1);
      expect(decrypt(envelope, replay)).toEqual(payload);
      state = nextState;
    }
  });

  it('round-trips arbitrary locations and status texts (property)', () => {
    fc.assert(
      fc.property(fc.oneof(locationArbitrary, statusArbitrary), (payload) => {
        const { envelope } = encryptMessage({
          state: createSenderState(senderKey),
          sender: alice,
          payload,
        });
        expect(decrypt(envelope)).toEqual(payload);
      }),
      { numRuns: 300 },
    );
  });

  it('never reuses key material: identical inputs give different ciphertexts', () => {
    const state = createSenderState(senderKey);
    const a = encryptMessage({ state, sender: alice, payload: locationPayload }).envelope;
    const b = encryptMessage({ state, sender: alice, payload: locationPayload }).envelope;
    expect(a.seq).toBe(b.seq);
    expect(a.salt).not.toBe(b.salt);
    expect(a.ct).not.toBe(b.ct);
  });

  it('hides payload length inside 128-byte blocks', () => {
    const short = encryptMessage({
      state: createSenderState(senderKey),
      sender: alice,
      payload: { kind: 'bump', ts: 1 },
    }).envelope;
    const long = encryptMessage({
      state: createSenderState(senderKey),
      sender: alice,
      payload: { kind: 'status', text: 'x'.repeat(40), expiresAt: 1, ts: 1 },
    }).envelope;
    expect(fromBase64url(short.ct).length).toBe(128 + 16);
    expect(fromBase64url(long.ct).length).toBe(128 + 16);
  });
});

describe('tamper resistance', () => {
  const { envelope } = encryptMessage({
    state: createSenderState(senderKey),
    sender: alice,
    payload: locationPayload,
  });

  it('rejects any single flipped bit in salt, ciphertext or signature (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom('salt', 'ct', 'sig'),
        fc.nat(),
        fc.integer({ min: 0, max: 7 }),
        (field, index, bit) => {
          const bytes = fromBase64url(envelope[field]);
          const position = index % bytes.length;
          bytes[position] = (bytes[position] ?? 0) ^ (1 << bit);
          const tampered = { ...envelope, [field]: toBase64url(bytes) };
          expect(codeOf(() => decrypt(tampered))).toBe('BAD_SIGNATURE');
          expect(verifyMessageEnvelope(tampered, alice.identity.publicKey)).toBe(false);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('rejects a changed sequence number (signature covers the header)', () => {
    expect(codeOf(() => decrypt({ ...envelope, seq: envelope.seq + 1 }))).toBe('BAD_SIGNATURE');
  });

  it('rejects envelopes for another circle, epoch or sender', () => {
    expect(codeOf(() => decrypt({ ...envelope, epoch: 3 }))).toBe('KEY_MISMATCH');
    expect(codeOf(() => decrypt({ ...envelope, circleId: ids.otherCircle }))).toBe('KEY_MISMATCH');
    expect(codeOf(() => decrypt({ ...envelope, senderDeviceId: ids.bobDevice }))).toBe(
      'KEY_MISMATCH',
    );
    expect(
      codeOf(() =>
        decryptMessage({
          envelope,
          senderKey,
          sender: publicKeysOf(bob),
          replay: new ReplayGuard(),
        }),
      ),
    ).toBe('KEY_MISMATCH');
  });

  it('rejects a signature from another identity key', () => {
    expect(
      codeOf(() =>
        decryptMessage({
          envelope,
          senderKey,
          sender: { ...aliceKeys, identityKey: bob.identity.publicKey },
          replay: new ReplayGuard(),
        }),
      ),
    ).toBe('BAD_SIGNATURE');
  });

  it('rejects malformed envelopes', () => {
    for (const bad of [
      null,
      { ...envelope, v: 2 },
      { ...envelope, salt: `${envelope.salt.slice(0, -1)}!` },
      { ...envelope, extra: true },
    ]) {
      expect(codeOf(() => decrypt(bad))).toBe('MALFORMED');
      expect(verifyMessageEnvelope(bad, alice.identity.publicKey)).toBe(false);
    }
  });

  it('lets the server verify envelopes without any key', () => {
    expect(verifyMessageEnvelope(envelope, alice.identity.publicKey)).toBe(true);
    expect(verifyMessageEnvelope(envelope, bob.identity.publicKey)).toBe(false);
  });
});

describe('replay protection', () => {
  it('rejects duplicates and older sequence numbers, accepts newer ones', () => {
    let state = createSenderState(senderKey);
    const envelopes: MessageEnvelope[] = [];
    for (let i = 0; i < 3; i++) {
      const result = encryptMessage({ state, sender: alice, payload: { kind: 'bump', ts: i } });
      envelopes.push(result.envelope);
      state = result.nextState;
    }
    const [first, second, third] = envelopes as [MessageEnvelope, MessageEnvelope, MessageEnvelope];
    const replay = new ReplayGuard();

    expect(decrypt(second, replay)).toEqual({ kind: 'bump', ts: 1 });
    expect(codeOf(() => decrypt(second, replay))).toBe('REPLAY');
    expect(codeOf(() => decrypt(first, replay))).toBe('REPLAY');
    expect(decrypt(third, replay)).toEqual({ kind: 'bump', ts: 2 });
  });

  it('does not advance the window for messages that fail authentication', () => {
    const { envelope } = encryptMessage({
      state: { senderKey, nextSeq: 10 },
      sender: alice,
      payload: { kind: 'bump', ts: 1 },
    });
    const replay = new ReplayGuard();
    expect(
      codeOf(() => decrypt({ ...envelope, sig: toBase64url(new Uint8Array(64)) }, replay)),
    ).toBe('BAD_SIGNATURE');
    expect(replay.isFresh(ids.aliceDevice, 2, 10)).toBe(true);
  });
});

describe('sender-side guards', () => {
  it('refuses to encrypt with another device’s sender key', () => {
    expect(
      codeOf(() =>
        encryptMessage({
          state: createSenderState(senderKey),
          sender: bob,
          payload: locationPayload,
        }),
      ),
    ).toBe('KEY_MISMATCH');
  });

  it('demands a new epoch once sequence numbers run out', () => {
    expect(
      codeOf(() =>
        encryptMessage({
          state: { senderKey, nextSeq: MAX_U32 + 1 },
          sender: alice,
          payload: locationPayload,
        }),
      ),
    ).toBe('REKEY_REQUIRED');
  });

  it('rejects invalid payloads before encrypting', () => {
    expect(
      codeOf(() =>
        encryptMessage({
          state: createSenderState(senderKey),
          sender: alice,
          payload: { ...locationPayload, lat: 120 } as Payload,
        }),
      ),
    ).toBe('MALFORMED');
  });
});

describe('a malicious sender with a valid key', () => {
  // Authenticated envelopes whose plaintext is not a valid payload must still be rejected.
  const forge = (padded: Uint8Array) =>
    encryptPaddedWith(
      { state: createSenderState(senderKey), sender: alice },
      padded,
      new Uint8Array(16),
    ).envelope;

  it.each([
    ['bad padding', new Uint8Array(128), 'DECRYPT_FAILED'],
    ['invalid UTF-8', pad(Uint8Array.of(0xff, 0xfe), 1024), 'MALFORMED'],
    ['non-JSON text', pad(utf8Encode('not json'), 1024), 'MALFORMED'],
    ['JSON outside the payload schema', pad(utf8Encode('{"kind":"loc"}'), 1024), 'MALFORMED'],
  ])('rejects %s', (_, padded, code) => {
    expect(codeOf(() => decrypt(forge(padded)))).toBe(code);
  });
});
