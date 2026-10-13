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
  ])('rejects %s', (_, payload) => {
    expect(payloadSchema.safeParse(payload).success).toBe(false);
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
    ct: b64(144),
    sig: b64(64),
  };

  it('accepts a well-formed message envelope', () => {
    expect(messageEnvelopeSchema.parse(envelope)).toEqual(envelope);
  });

  it.each([
    ['unknown version', { ...envelope, v: 2 }],
    ['seq beyond u32', { ...envelope, seq: 2 ** 32 }],
    ['short salt', { ...envelope, salt: b64(15) }],
    ['ciphertext above the frame budget', { ...envelope, ct: b64(1041) }],
    ['ciphertext below the padding minimum', { ...envelope, ct: b64(143) }],
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
