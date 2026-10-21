import { describe, expect, it } from 'vitest';

import {
  bumpRequestSchema,
  devicePushesSchema,
  MAX_SEALED_PUSH_CHARS,
  payloadSchema,
  placePutSchema,
  pushBodySchema,
  serverEventSchema,
} from './index.js';

const uuid = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));
const envelope = {
  v: 1,
  circleId: uuid,
  epoch: 1,
  senderDeviceId: uuid,
  seq: 0,
  salt: b64(16),
  ct: b64(528),
  sig: b64(64),
};

describe('places', () => {
  const place = {
    kind: 'place',
    id: uuid,
    name: 'Ev',
    emoji: '🏠',
    lat: 41.0082,
    lng: 28.9784,
    radius: 250,
    ts: 1,
  };

  it('accepts a place and keeps its radius within a house and a campus', () => {
    expect(payloadSchema.parse(place)).toEqual(place);
    expect(payloadSchema.safeParse({ ...place, radius: 20 }).success).toBe(false);
    expect(payloadSchema.safeParse({ ...place, radius: 5_000 }).success).toBe(false);
    expect(payloadSchema.safeParse({ ...place, radius: 100.5 }).success).toBe(false);
  });

  it('refuses names that could fool the eye or overflow the message', () => {
    expect(payloadSchema.safeParse({ ...place, name: '' }).success).toBe(false);
    expect(payloadSchema.safeParse({ ...place, name: 'x'.repeat(41) }).success).toBe(false);
    expect(
      payloadSchema.safeParse({ ...place, name: `Ev${String.fromCharCode(0x202e)}` }).success,
    ).toBe(false);
    expect(payloadSchema.safeParse({ ...place, extra: true }).success).toBe(false);
  });

  it('saves with the version it replaces, null for a new place', () => {
    expect(placePutSchema.parse({ envelope, version: null }).version).toBeNull();
    expect(placePutSchema.parse({ envelope, version: 3 }).version).toBe(3);
    expect(placePutSchema.safeParse({ envelope, version: 0 }).success).toBe(false);
  });

  it('announces changes with the circle only', () => {
    const event = { type: 'places.changed', circleId: uuid };
    expect(serverEventSchema.parse(event)).toEqual(event);
    expect(serverEventSchema.safeParse({ ...event, placeId: uuid }).success).toBe(false);
  });
});

describe('push bodies', () => {
  it('accepts the three kinds', () => {
    for (const body of [
      {
        kind: 'place',
        circleId: uuid,
        placeId: uuid,
        event: 'enter',
        name: 'Okul',
        emoji: '🏫',
        ts: 1,
      },
      { kind: 'bump', circleId: uuid, ts: 1 },
      { kind: 'notice', notice: 'circleInvite', circleId: uuid, ts: 1 },
    ]) {
      expect(pushBodySchema.parse(body)).toEqual(body);
    }
  });

  it('has a watch notice that names the circle and nobody else (docs/ADR/0028 step 3)', () => {
    const body = { kind: 'notice', notice: 'watch', circleId: uuid, ts: 1 };
    expect(pushBodySchema.parse(body)).toEqual(body);
    // No watcher, device or signature can ride along.
    for (const extra of [{ watcherId: uuid }, { userId: uuid }, { deviceId: uuid }, { sig: 'x' }]) {
      expect(pushBodySchema.safeParse({ ...body, ...extra }).success).toBe(false);
    }
  });

  it('refuses unknown notices, events and fields', () => {
    expect(
      pushBodySchema.safeParse({ kind: 'notice', notice: 'hello', circleId: uuid, ts: 1 }).success,
    ).toBe(false);
    expect(
      pushBodySchema.safeParse({
        kind: 'place',
        circleId: uuid,
        placeId: uuid,
        event: 'near',
        name: 'Ev',
        emoji: '🏠',
        ts: 1,
      }).success,
    ).toBe(false);
    expect(
      pushBodySchema.safeParse({ kind: 'bump', circleId: uuid, ts: 1, text: 'x' }).success,
    ).toBe(false);
  });

  it('caps sealed boxes in size and alphabet, and one per member', () => {
    const one = { userId: uuid, deviceId: uuid, sealed: 'A'.repeat(MAX_SEALED_PUSH_CHARS) };
    expect(devicePushesSchema.parse([one])).toEqual([one]);
    expect(
      devicePushesSchema.safeParse([{ ...one, sealed: 'A'.repeat(MAX_SEALED_PUSH_CHARS + 1) }])
        .success,
    ).toBe(false);
    expect(devicePushesSchema.safeParse([{ ...one, sealed: 'AB+/' }]).success).toBe(false);
    expect(devicePushesSchema.safeParse(Array.from({ length: 51 }, () => one)).success).toBe(false);
  });

  it('lets a poke come without notifications (older apps)', () => {
    expect(bumpRequestSchema.parse({ envelope }).pushes).toBeUndefined();
    expect(bumpRequestSchema.parse({ envelope, pushes: [] }).pushes).toEqual([]);
  });
});

describe('profile messages', () => {
  const photo = { id: uuid, key: 'A'.repeat(43) };

  it("may hand back up to two members' photo keys", () => {
    const given = { userId: uuid, id: uuid, key: 'B'.repeat(43) };
    const profile = { kind: 'profile', photo: null, returns: [given, given], ts: 1 };
    expect(payloadSchema.parse(profile)).toEqual(profile);
    expect(payloadSchema.safeParse({ ...profile, returns: [given, given, given] }).success).toBe(
      false,
    );
    expect(payloadSchema.safeParse({ ...profile, returns: [] }).success).toBe(false);
    expect(
      payloadSchema.safeParse({ ...profile, returns: [{ ...given, key: 'short' }] }).success,
    ).toBe(false);
    expect(payloadSchema.parse({ kind: 'profile', photo, ts: 1 })).toEqual({
      kind: 'profile',
      photo,
      ts: 1,
    });
  });
});
