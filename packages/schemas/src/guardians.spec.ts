import { describe, expect, it } from 'vitest';

import { guardianViewSchema } from './index.js';

const uuid = (n: number) => `0190f7a4-5b6c-7d8e-9f01-${String(n).padStart(12, '0')}`;
const view = (requests: unknown[]) => ({
  link: {
    id: uuid(1),
    role: 'guardian',
    status: 'active',
    other: { username: 'deniz', displayName: null, avatar: null },
    createdAt: 1,
    activeAt: 2,
    endRequestedAt: null,
    endsAt: null,
  },
  child: { username: 'deniz', displayName: 'Deniz', avatar: null },
  ageBand: '15-17',
  circles: [],
  settings: { approveNewPeople: true, dailyLimitMinutes: null, updatedAt: 3, updatedBy: null },
  usage: [],
  requests,
});

describe('guardian view', () => {
  it('reads a purchase request, and skips a request of a kind this app does not know', () => {
    const purchase = {
      id: uuid(2),
      kind: 'purchase',
      name: null,
      memberCount: null,
      by: null,
      product: 'plus_year',
      createdAt: 4,
    };
    const newer = { ...purchase, id: uuid(3), kind: 'somethingNewer' };
    const parsed = guardianViewSchema.parse(view([purchase, newer]));
    expect(parsed.requests).toEqual([purchase]);
  });

  it('reads a cosmetic request beside a purchase request, by the pack asked for', () => {
    const purchase = {
      id: uuid(2),
      kind: 'purchase',
      name: null,
      memberCount: null,
      by: null,
      product: 'plus_month',
      createdAt: 4,
    };
    const cosmetic = {
      id: uuid(3),
      kind: 'cosmetic',
      name: null,
      memberCount: null,
      by: null,
      pack: 'rings',
      createdAt: 5,
    };
    // A pack this app has never heard of is still read (and worded in general); a field a newer
    // server adds is dropped, not an error.
    const newerPack = { ...cosmetic, id: uuid(4), pack: 'seasonal_7', extra: true };
    const parsed = guardianViewSchema.parse(view([purchase, cosmetic, newerPack]));
    expect(parsed.requests.map((request) => request.kind)).toEqual([
      'purchase',
      'cosmetic',
      'cosmetic',
    ]);
    expect(parsed.requests.map((request) => request.pack)).toEqual([
      undefined,
      'rings',
      'seasonal_7',
    ]);
    // Not a pack id at all: that request is skipped, the others are not.
    const broken = { ...cosmetic, id: uuid(5), pack: 'cosmetic:rings' };
    expect(guardianViewSchema.parse(view([broken, purchase])).requests).toEqual([purchase]);
  });
});
