import { describe, expect, it } from 'vitest';

import {
  circleCreateSchema,
  inviteCreateSchema,
  inviteTokenSchema,
  keyUploadSchema,
  MAX_CIRCLE_MEMBERS,
  serverEventSchema,
} from './index.js';

const uuid = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));
const distribution = {
  v: 1,
  circleId: uuid,
  epoch: 2,
  senderDeviceId: uuid,
  recipientDeviceId: uuid,
  ephemeralKey: b64(32),
  ct: b64(48),
  sig: b64(64),
};

describe('circle schemas', () => {
  it('create only group circles with a visible name (pairs come from friend requests)', () => {
    expect(circleCreateSchema.parse({ kind: 'family', name: '  Ailem ' })).toEqual({
      kind: 'family',
      name: 'Ailem',
    });
    expect(circleCreateSchema.safeParse({ kind: 'pair', name: 'x' }).success).toBe(false);
    expect(circleCreateSchema.safeParse({ kind: 'friends', name: '\u200B' }).success).toBe(false);
  });

  it('accept invite tokens of exactly 256 bits in base64url', () => {
    expect(inviteTokenSchema.safeParse(b64(32).slice(0, 43)).success).toBe(true);
    expect(inviteTokenSchema.safeParse('short').success).toBe(false);
    expect(inviteTokenSchema.safeParse(`${'A'.repeat(42)}=`).success).toBe(false);
  });

  it('tell friend invites from circle invites', () => {
    expect(inviteCreateSchema.parse({ kind: 'friend' })).toEqual({ kind: 'friend' });
    expect(inviteCreateSchema.safeParse({ kind: 'friend', circleId: uuid }).success).toBe(false);
    expect(inviteCreateSchema.safeParse({ kind: 'circle' }).success).toBe(false);
  });

  it('cap key uploads at one copy per other member', () => {
    const many = Array.from({ length: MAX_CIRCLE_MEMBERS }, () => distribution);
    expect(keyUploadSchema.safeParse({ epoch: 2, distributions: [distribution] }).success).toBe(
      true,
    );
    expect(keyUploadSchema.safeParse({ epoch: 2, distributions: many }).success).toBe(false);
    expect(keyUploadSchema.safeParse({ epoch: 2, distributions: [] }).success).toBe(false);
  });

  it('describe events without personal data', () => {
    expect(
      serverEventSchema.parse({ type: 'keys.available', circleId: uuid, epoch: 3 }),
    ).toBeTruthy();
    expect(
      serverEventSchema.safeParse({ type: 'circle.gone', circleId: uuid, name: 'Ailem' }).success,
    ).toBe(false);
  });
});
