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
});
