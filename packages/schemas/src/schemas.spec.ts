import { describe, expect, it } from 'vitest';

import { messageEnvelopeSchema, payloadSchema, senderKeyDistributionSchema } from './index.js';

const uuid = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));

describe('payloadSchema', () => {
  const loc = {
    kind: 'loc',
    lat: 41.0082,
    lng: 28.9784,
    acc: 12,
    spd: 1.4,
    hdg: 90,
    bat: 76,
    chg: false,
    ts: 1_791_880_000_000,
  };

  it('accepts every payload kind', () => {
    for (const payload of [
      loc,
      { kind: 'bump', ts: 1 },
      { kind: 'place_enter', placeId: uuid, ts: 1 },
      { kind: 'place_exit', placeId: uuid, ts: 1 },
      { kind: 'share_stop', ts: 1 },
      { kind: 'status', emoji: '☕', text: 'kahve', expiresAt: 2, ts: 1 },
    ]) {
      expect(payloadSchema.parse(payload)).toEqual(payload);
    }
  });

  it.each([
    ['latitude out of range', { ...loc, lat: 90.1 }],
    ['longitude out of range', { ...loc, lng: -180.5 }],
    ['heading of 360', { ...loc, hdg: 360 }],
    ['fractional battery', { ...loc, bat: 50.5 }],
    ['unknown field', { ...loc, extra: true }],
    ['unknown kind', { kind: 'teleport', ts: 1 }],
    ['negative timestamp', { kind: 'bump', ts: -1 }],
    ['over-long status text', { kind: 'status', text: 'x'.repeat(81), expiresAt: 2, ts: 1 }],
    ['control character in status', { kind: 'status', text: 'a\u0000b', expiresAt: 2, ts: 1 }],
    ['bidi override in status', { kind: 'status', text: 'a\u202Eb', expiresAt: 2, ts: 1 }],
    ['lone surrogate in status emoji', { kind: 'status', emoji: '\uD83D', expiresAt: 2, ts: 1 }],
  ])('rejects %s', (_, payload) => {
    expect(payloadSchema.safeParse(payload).success).toBe(false);
  });
});

describe('state payload (docs/ADR/0028, "Neden eski?")', () => {
  const state = { kind: 'state', why: 'saver', since: 1_791_880_000_000, ts: 1_791_880_300_000 };

  it.each(['saver', 'permission', 'nofix', 'none'])('accepts the reason %s', (why) => {
    expect(payloadSchema.parse({ ...state, why })).toEqual({ ...state, why });
  });

  it.each([
    [
      '"offline" as a reason (the receiver infers it, nobody sends it)',
      { ...state, why: 'offline' },
    ],
    ['an unknown reason', { ...state, why: 'airplane' }],
    ['no reason', { kind: 'state', since: 1, ts: 1 }],
    ['no start', { kind: 'state', why: 'saver', ts: 1 }],
    ['a negative start', { ...state, since: -1 }],
    ['a fractional time', { ...state, ts: 1.5 }],
  ])('rejects %s', (_, payload) => {
    expect(payloadSchema.safeParse(payload).success).toBe(false);
  });

  it('is read leniently: a field a newer phone adds is dropped, and a position never survives', () => {
    const read = payloadSchema.parse({ ...state, lat: 41.0082, lng: 28.9784, acc: 5, extra: true });
    expect(read).toEqual(state);
    expect(Object.keys(read).sort()).toEqual(['kind', 'since', 'ts', 'why']);
  });
});

describe('wire schemas', () => {
  const envelope = {
    v: 1,
    circleId: uuid,
    epoch: 3,
    senderDeviceId: uuid,
    seq: 7,
    salt: b64(16),
    ct: b64(528),
    sig: b64(64),
  };

  it('accepts a well-formed message envelope', () => {
    expect(messageEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it.each([
    ['unknown version', { ...envelope, v: 2 }],
    ['seq beyond u32', { ...envelope, seq: 2 ** 32 }],
    ['short salt', { ...envelope, salt: b64(15) }],
    ['ciphertext longer than the fixed size', { ...envelope, ct: b64(529) }],
    ['ciphertext shorter than the fixed size', { ...envelope, ct: b64(527) }],
    ['non-base64url signature', { ...envelope, sig: `${b64(63)}+=` }],
    ['extra field', { ...envelope, plaintext: 'oops' }],
  ])('rejects an envelope with %s', (_, value) => {
    expect(messageEnvelopeSchema.safeParse(value).success).toBe(false);
  });

  it('accepts a well-formed sender key distribution', () => {
    const distribution = {
      v: 1,
      circleId: uuid,
      epoch: 0,
      senderDeviceId: uuid,
      recipientDeviceId: uuid,
      ephemeralKey: b64(32),
      ct: b64(48),
      sig: b64(64),
    };
    expect(senderKeyDistributionSchema.parse(distribution)).toEqual(distribution);
  });
});
