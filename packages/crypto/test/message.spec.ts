import type { MessageEnvelope, Payload } from '@bargu/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MAX_U32, MESSAGE_PADDED_BYTES } from '../src/constants.js';
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

const fixedPad = (data: Uint8Array) => pad(data, MESSAGE_PADDED_BYTES, MESSAGE_PADDED_BYTES);

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

  it('gives every payload the same ciphertext size, even the largest of each kind', () => {
    const maxTs = Number.MAX_SAFE_INTEGER;
    // The longest JSON spelling of a double (17 digits plus an exponent): 2^-1022.
    const longest = 2.2250738585072014e-308;
    // Worst cases for the JSON size: longest numbers and the widest characters the schema allows.
    const payloads: Payload[] = [
      { kind: 'bump', ts: 1 },
      {
        kind: 'loc',
        lat: -longest,
        lng: -longest,
        acc: longest,
        spd: longest,
        hdg: longest,
        bat: 100,
        chg: false,
        ts: maxTs,
      },
      { kind: 'place_enter', placeId: ids.place, ts: maxTs },
      { kind: 'place_exit', placeId: ids.place, ts: maxTs },
      { kind: 'share_stop', ts: maxTs },
      // 3 UTF-8 bytes per UTF-16 unit is the maximum (astral characters take 4 bytes per 2 units).
      {
        kind: 'status',
        emoji: '❤'.repeat(16),
        text: 'ࠀ'.repeat(80),
        expiresAt: maxTs,
        ts: maxTs,
      },
      {
        kind: 'place',
        id: ids.place,
        name: 'ࠀ'.repeat(40),
        emoji: '❤'.repeat(16),
        lat: -longest,
        lng: -longest,
        radius: 1_000,
        ts: maxTs,
      },
      {
        kind: 'profile',
        photo: { id: ids.place, key: 'A'.repeat(43) },
        returns: [
          { userId: ids.aliceUser, id: ids.place, key: 'B'.repeat(43) },
          { userId: ids.bobUser, id: ids.place, key: 'C'.repeat(43) },
        ],
        ts: maxTs,
      },
      // Güvendeyim (docs/ADR/0029): the widest numbers, the longest id.
      {
        kind: 'safe',
        id: 'z'.repeat(21) + 'A',
        lat: -longest,
        lng: -longest,
        acc: longest,
        bat: 100,
        ts: maxTs,
      },
      // The largest look (docs/ADR/0025): every id at its longest, as many packs as a pass names.
      {
        kind: 'look',
        ring: 'z'.repeat(16),
        frame: 'z'.repeat(16),
        pass: {
          v: 1,
          kid: 'k'.repeat(16),
          userId: ids.aliceUser,
          packs: ['a', 'b', 'c', 'd', 'e', 'f'].map((letter) => letter.repeat(16)),
          issuedAt: maxTs,
          expiresAt: maxTs,
          sig: 'A'.repeat(86),
        },
        ts: maxTs,
      },
    ];
    for (const payload of payloads) {
      const { envelope } = encryptMessage({
        state: createSenderState(senderKey),
        sender: alice,
        payload,
      });
      expect(fromBase64url(envelope.ct)).toHaveLength(MESSAGE_PADDED_BYTES + 16);
      expect(decrypt(envelope)).toEqual(payload);
    }
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
  it('rejects duplicates and accepts each message once, in any order', () => {
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
    expect(decrypt(first, replay)).toEqual({ kind: 'bump', ts: 0 });
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
    expect(replay.check(ids.circle, ids.aliceDevice, 2, 10)).toBe('latest');
  });

  it('delivers reordered events once, but never an older location', () => {
    let state = createSenderState(senderKey);
    const send = (payload: Payload) => {
      const result = encryptMessage({ state, sender: alice, payload });
      state = result.nextState;
      return result.envelope;
    };
    const enter = send({ kind: 'place_enter', placeId: ids.place, ts: 1 });
    const oldLocation = send(locationPayload);
    const newLocation = send({ ...locationPayload, ts: locationPayload.ts + 1 });
    const replay = new ReplayGuard();

    expect(decrypt(newLocation, replay)).toEqual({
      ...locationPayload,
      ts: locationPayload.ts + 1,
    });
    // The place event arrives late: still delivered, exactly once.
    expect(decrypt(enter, replay)).toEqual({ kind: 'place_enter', placeId: ids.place, ts: 1 });
    expect(codeOf(() => decrypt(enter, replay))).toBe('REPLAY');
    // A late location is authentic but stale; it is recorded so it cannot come back either.
    expect(codeOf(() => decrypt(oldLocation, replay))).toBe('STALE');
    expect(codeOf(() => decrypt(oldLocation, replay))).toBe('REPLAY');
  });

  it('tracks each circle separately for the same sender and epoch', () => {
    const otherKey = generateSenderKey({
      circleId: ids.otherCircle,
      epoch: 2,
      senderDeviceId: ids.aliceDevice,
    });
    const replay = new ReplayGuard();
    const inCircle = encryptMessage({
      state: { senderKey, nextSeq: 5 },
      sender: alice,
      payload: { kind: 'bump', ts: 1 },
    });
    const inOther = encryptMessage({
      state: createSenderState(otherKey),
      sender: alice,
      payload: { kind: 'bump', ts: 2 },
    });

    expect(decrypt(inCircle.envelope, replay)).toEqual({ kind: 'bump', ts: 1 });
    expect(
      decryptMessage({
        envelope: inOther.envelope,
        senderKey: otherKey,
        sender: aliceKeys,
        replay,
      }),
    ).toEqual({ kind: 'bump', ts: 2 });
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
    ['bad padding', new Uint8Array(MESSAGE_PADDED_BYTES), 'DECRYPT_FAILED'],
    ['invalid UTF-8', fixedPad(Uint8Array.of(0xff, 0xfe)), 'MALFORMED'],
    ['non-JSON text', fixedPad(utf8Encode('not json')), 'MALFORMED'],
    ['JSON outside the payload schema', fixedPad(utf8Encode('{"kind":"loc"}')), 'MALFORMED'],
  ])('rejects %s', (_, padded, code) => {
    expect(codeOf(() => decrypt(forge(padded)))).toBe(code);
  });
});

describe('a newer phone (forward compatibility, ADR 0024 §10)', () => {
  const forge = (payload: unknown) =>
    encryptPaddedWith(
      { state: createSenderState(senderKey), sender: alice },
      fixedPad(utf8Encode(JSON.stringify(payload))),
      new Uint8Array(16),
    ).envelope;

  it('reads its profile, dropping a field this version does not know', () => {
    const profile = { kind: 'profile', photo: null, ts: 1 };
    expect(decrypt(forge({ ...profile, look: { island: 'stripes' } }))).toEqual(profile);
  });

  it('refuses a kind this version does not know (the receiver ignores it)', () => {
    expect(codeOf(() => decrypt(forge({ kind: 'look', ts: 1 })))).toBe('MALFORMED');
  });
});
