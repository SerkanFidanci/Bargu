import { describe, expect, it } from 'vitest';

import {
  bumpRequestSchema,
  devicePushesSchema,
  MAX_SEALED_PUSH_CHARS,
  payloadSchema,
  placePutSchema,
  pushBodySchema,
  safeIdSchema,
  safePayloadSchema,
  safeReplySchema,
  safeRequestSchema,
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
      { kind: 'poke', circleId: uuid, style: 'kiss', ts: 1 },
      { kind: 'poke', circleId: uuid, style: 'reply', say: 'home', ts: 1 },
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

describe('Güvendeyim (docs/ADR/0029)', () => {
  // 16 bytes of base64url: 22 characters, the last one carrying no stray bits.
  const id = 'AAAAAAAAAAAAAAAAAAAAAA';
  const safe = {
    kind: 'safe',
    id,
    lat: 41.0082,
    lng: 28.9784,
    acc: 12,
    bat: 45,
    ts: 1_791_880_000_000,
  };

  it('is a message kind of its own, strict, with a location and the battery', () => {
    expect(payloadSchema.parse(safe)).toEqual(safe);
    expect(safePayloadSchema.parse(safe)).toEqual(safe);
    for (const bad of [
      { ...safe, lat: 91 },
      { ...safe, lng: -181 },
      { ...safe, bat: 101 },
      { ...safe, bat: 45.5 },
      { ...safe, acc: -1 },
      { ...safe, spd: 1 },
      { ...safe, extra: true },
      { ...safe, id: undefined },
    ]) {
      expect(payloadSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('names a message by 16 random bytes in canonical base64url, nothing else', () => {
    expect(safeIdSchema.safeParse(id).success).toBe(true);
    expect(safeIdSchema.safeParse('AAAAAAAAAAAAAAAAAAAAAQ').success).toBe(true);
    for (const bad of [
      '',
      'A'.repeat(21),
      'A'.repeat(23),
      'AAAAAAAAAAAAAAAAAAAAAB', // stray bits in the last character
      'AAAAAAAAAAAAAAAAAAAAA+',
      'AAAAAAAAAAAAAAAAAAAAA=',
    ]) {
      expect(safeIdSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('is asked for with the id in the clear next to the sealed message and its notifications', () => {
    expect(safeRequestSchema.parse({ id, envelope })).toEqual({ id, envelope });
    expect(safeRequestSchema.parse({ id, envelope, pushes: [] }).pushes).toEqual([]);
    for (const bad of [
      { envelope },
      { id, envelope, extra: 1 },
      { id: 'short', envelope },
      { id, envelope: { ...envelope, ct: b64(10) } },
    ]) {
      expect(safeRequestSchema.safeParse(bad).success).toBe(false);
    }
    expect(safeReplySchema.parse({ ok: true })).toEqual({ ok: true });
    expect(safeReplySchema.parse({ refused: 'RATE_LIMITED' })).toEqual({ refused: 'RATE_LIMITED' });
    expect(safeReplySchema.safeParse({ refused: 'WHATEVER' }).success).toBe(false);
  });

  it('has a notification body with the battery, no name and no text; the place whole or not at all', () => {
    const body = { kind: 'safe', circleId: uuid, id, bat: 45, ts: 1 };
    // From a phone before the place was in it: the words only.
    expect(pushBodySchema.parse(body)).toEqual(body);
    // With the place (docs/ADR/0029 §5): where, at that circle's precision, and how sure.
    const placed = { ...body, lat: 41.0256, lng: 28.9742, acc: 8 };
    expect(pushBodySchema.parse(placed)).toEqual(placed);
    for (const bad of [
      { ...body, lat: 41 },
      { ...body, lng: 29 },
      { ...body, acc: 8 },
      { ...body, lat: 41, lng: 29 },
      { ...placed, acc: undefined },
      { ...placed, lat: 90.5 },
      { ...placed, lng: -181 },
      { ...placed, acc: -1 },
      { ...placed, name: 'Ayşe' },
      { ...placed, spd: 1 },
      { ...body, name: 'Ayşe' },
      { ...body, bat: 120 },
      { ...body, id: 'x' },
      { kind: 'safe', circleId: uuid, bat: 45, ts: 1 },
    ]) {
      expect(pushBodySchema.safeParse(bad).success).toBe(false);
    }
  });
});
