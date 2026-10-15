import { describe, expect, it } from 'vitest';

import {
  docEnvelopeSchema,
  docPayloadSchema,
  docPutSchema,
  payloadSchema,
  pushBodySchema,
} from './index.js';

const uuid = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));

describe('event planning (docs/ADR/0018)', () => {
  it('keeps a meeting: time and place, either possibly undecided', () => {
    for (const plan of [
      { kind: 'plan', id: uuid, meetAt: 5, placeId: uuid, ts: 1 },
      { kind: 'plan', id: uuid, ts: 1 },
    ]) {
      expect(docPayloadSchema.parse(plan)).toEqual(plan);
      // A document never travels as a message.
      expect(payloadSchema.safeParse(plan).success).toBe(false);
    }
  });

  it('polls on time or place with two to four matching options', () => {
    const times = {
      kind: 'poll',
      id: uuid,
      by: uuid,
      about: 'time',
      options: [{ at: 1 }, { at: 2 }],
      ts: 1,
    };
    const places = {
      kind: 'poll',
      id: uuid,
      by: uuid,
      about: 'place',
      options: [
        { placeId: uuid, name: 'Sahne' },
        { placeId: uuid, name: 'Kafe' },
      ],
      closed: { choice: 1 },
      ts: 1,
    };
    expect(docPayloadSchema.parse(times)).toEqual(times);
    expect(docPayloadSchema.parse(places)).toEqual(places);
    expect(docPayloadSchema.safeParse({ ...times, options: [{ at: 1 }] }).success).toBe(false);
    expect(
      docPayloadSchema.safeParse({ ...times, options: [1, 2, 3, 4, 5].map((at) => ({ at })) })
        .success,
    ).toBe(false);
    // A place in a time poll, a choice that does not exist.
    expect(docPayloadSchema.safeParse({ ...times, options: places.options }).success).toBe(false);
    expect(docPayloadSchema.safeParse({ ...times, closed: { choice: 3 } }).success).toBe(false);
  });

  it('votes for existing options only, and reports lateness in minutes', () => {
    expect(
      docPayloadSchema.parse({ kind: 'vote', id: uuid, pollId: uuid, choices: [0, 2], ts: 1 }),
    ).toMatchObject({ choices: [0, 2] });
    expect(
      docPayloadSchema.safeParse({ kind: 'vote', id: uuid, pollId: uuid, choices: [4], ts: 1 })
        .success,
    ).toBe(false);
    expect(
      docPayloadSchema.safeParse({ kind: 'late', meetAt: 5, minutes: 12, ts: 1 }).success,
    ).toBe(false);
    expect(payloadSchema.parse({ kind: 'late', meetAt: 5, minutes: 12, ts: 1 })).toMatchObject({
      minutes: 12,
    });
    expect(payloadSchema.safeParse({ kind: 'late', meetAt: 5, minutes: 0, ts: 1 }).success).toBe(
      false,
    );
    expect(
      pushBodySchema.parse({ kind: 'late', circleId: uuid, minutes: 12, ts: 1 }),
    ).toMatchObject({ kind: 'late' });
  });

  it('lets a location carry the estimated arrival', () => {
    const loc = {
      kind: 'loc',
      lat: 41,
      lng: 29,
      acc: 8,
      bat: 70,
      chg: false,
      eta: { meetAt: 10, at: 9 },
      ts: 1,
    };
    expect(payloadSchema.parse(loc)).toEqual(loc);
    expect(payloadSchema.safeParse({ ...loc, eta: { at: 9 } }).success).toBe(false);
  });

  it('stores documents in a larger fixed-size envelope', () => {
    const envelope = {
      v: 1,
      circleId: uuid,
      epoch: 1,
      senderDeviceId: uuid,
      seq: 0,
      salt: b64(16),
      ct: b64(1040),
      sig: b64(64),
    };
    expect(docEnvelopeSchema.parse(envelope)).toEqual(envelope);
    expect(docEnvelopeSchema.safeParse({ ...envelope, ct: b64(528) }).success).toBe(false);
    expect(docPutSchema.parse({ envelope, version: null, shared: true }).shared).toBe(true);
    expect(docPutSchema.safeParse({ envelope, version: null }).success).toBe(false);
  });
});
