import type { Circle, MemberCard } from '@bargu/schemas';

import { DEFAULT_SHARING, type SharingSettings } from '../location/sharing';
import type { ChatItem } from './messages';
import {
  NEAR_COARSE_M,
  NEAR_EVERY_MS,
  NEAR_FRESH_MS,
  nearCircleOf,
  nearDistance,
  nearTargets,
} from './near';

const ME = '0190f7a4-1111-7111-8111-000000000001';
const ALI = '0190f7a4-1111-7111-8111-000000000002';
const NOW = 1_800_000_000_000;

const member = (userId: string, status: MemberCard['status'] = 'active'): MemberCard => ({
  userId,
  role: 'member',
  status,
  username: null,
  displayName: userId === ALI ? 'Ali' : `Kişi ${userId.slice(-2)}`,
  avatar: null,
  device: null,
});
const circleOf = (
  id: string,
  kind: Circle['kind'],
  members: MemberCard[],
  extra: Partial<Circle> = {},
): Circle => ({
  id,
  kind,
  name: kind === 'pair' ? null : `Çember ${id.slice(-1)}`,
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members,
  ...extra,
});
const others = (count: number) =>
  Array.from({ length: count }, (_, index) =>
    member(`0190f7a4-1111-7111-8111-0000000001${String(index).padStart(2, '0')}`),
  );
const sharingWith = (...ids: string[]): SharingSettings => ({
  ...DEFAULT_SHARING,
  circles: Object.fromEntries(
    ids.map((id) => [id, { sharing: true, precision: 'exact', until: null }]),
  ),
});

const PAIR = '0190f7a4-5b6c-7d8e-9f01-00000000000a';
const SMALL = '0190f7a4-5b6c-7d8e-9f01-00000000000b';
const BIG = '0190f7a4-5b6c-7d8e-9f01-00000000000c';
const EVENT = '0190f7a4-5b6c-7d8e-9f01-00000000000d';
const PAUSED = '0190f7a4-5b6c-7d8e-9f01-00000000000e';
const ALONE = '0190f7a4-5b6c-7d8e-9f01-00000000000f';
const circles = [
  circleOf(PAIR, 'pair', [member(ME), member(ALI)]),
  circleOf(SMALL, 'friends', [member(ME), ...others(7)]),
  circleOf(BIG, 'friends', [member(ME), ...others(8)]),
  circleOf(EVENT, 'event', [member(ME), member(ALI)]),
  circleOf(PAUSED, 'family', [member(ME), member(ALI)], { paused: true }),
  circleOf(ALONE, 'family', [member(ME), member(ALI, 'invited')]),
];
const all = sharingWith(PAIR, SMALL, BIG, EVENT, PAUSED, ALONE);

describe('where "Yakındayım" can go (docs/ADR/0037 §3, the PM 2026-10-29)', () => {
  it('a friendship as the friend, and a lasting circle of at most eight with someone in it', () => {
    const targets = nearTargets(circles, all, ME, [], NOW);
    expect(targets.map((target) => target.circleId)).toEqual([PAIR, SMALL]);
    expect(targets[0]).toMatchObject({ conversation: `p:${ALI}`, title: 'Ali', people: [ALI] });
    expect(targets[1]).toMatchObject({ conversation: `c:${SMALL}`, waitMs: 0 });
    expect(targets[1]?.people).toHaveLength(7);
  });

  it('only where the location goes now: never as a ghost, nor with sharing off or over', () => {
    expect(nearTargets(circles, { ...all, ghost: 'freeze' }, ME, [], NOW)).toEqual([]);
    expect(nearTargets(circles, { ...all, ghost: 'hide' }, ME, [], NOW)).toEqual([]);
    const off: SharingSettings = {
      ...all,
      circles: { ...all.circles, [PAIR]: { sharing: false, precision: 'exact', until: null } },
    };
    expect(nearTargets(circles, off, ME, [], NOW).map((t) => t.circleId)).toEqual([SMALL]);
    const over: SharingSettings = {
      ...all,
      circles: { ...all.circles, [PAIR]: { sharing: true, precision: 'exact', until: NOW - 1 } },
    };
    expect(nearTargets(circles, over, ME, [], NOW).map((t) => t.circleId)).toEqual([SMALL]);
  });

  it('once in ten minutes to the same place, counted from what this phone sent', () => {
    const sent = {
      id: 'x',
      conversation: `p:${ALI}`,
      from: ME,
      at: NOW - 4 * 60_000,
      kind: 'near',
      state: 'sent',
    } as ChatItem;
    const [pair, small] = nearTargets(circles, all, ME, [sent], NOW);
    expect(pair?.waitMs).toBe(NEAR_EVERY_MS - 4 * 60_000);
    expect(small?.waitMs).toBe(0);
    // One that failed starts no wait (QA-41).
    expect(nearTargets(circles, all, ME, [{ ...sent, state: 'failed' }], NOW)[0]?.waitMs).toBe(0);
    // Someone else's, or one older than ten minutes, does not count.
    expect(nearTargets(circles, all, ME, [{ ...sent, from: ALI }], NOW)[0]?.waitMs).toBe(0);
    expect(
      nearTargets(circles, all, ME, [{ ...sent, at: NOW - NEAR_EVERY_MS }], NOW)[0]?.waitMs,
    ).toBe(0);
  });
});

describe('how far, on the phone it reaches (docs/ADR/0037 §2)', () => {
  const mine = { lat: 41.0, lng: 29.0, ts: NOW };
  const theirs = (overrides: Partial<{ lat: number; acc: number; ts: number }> = {}) => ({
    lat: 41.00315,
    lng: 29.0,
    acc: 8,
    ts: NOW,
    ...overrides,
  });

  it('is worked out from both fresh locations, to 50 m, and never less than 50', () => {
    expect(nearDistance(theirs(), mine, NOW)).toBe(350);
    expect(nearDistance(theirs({ lat: 41.0001 }), mine, NOW)).toBe(50);
  });

  it('is only "nearby" through a coarse cell, when either is old, or without one', () => {
    expect(nearDistance(theirs({ acc: NEAR_COARSE_M }), mine, NOW)).toBe('nearby');
    expect(nearDistance(theirs({ ts: NOW - NEAR_FRESH_MS - 1 }), mine, NOW)).toBe('nearby');
    expect(nearDistance(theirs(), { ...mine, ts: NOW - NEAR_FRESH_MS - 1 }, NOW)).toBe('nearby');
    expect(nearDistance(undefined, mine, NOW)).toBe('nearby');
    expect(nearDistance(theirs(), null, NOW)).toBe('nearby');
  });

  it('takes the sender from the circle, or for a friend the friendship', () => {
    expect(nearCircleOf(`c:${SMALL}`, circles, ALI)).toBe(SMALL);
    expect(nearCircleOf(`p:${ALI}`, circles, ALI)).toBe(PAIR);
    expect(nearCircleOf(`p:${ME}`, [], ME)).toBeNull();
  });
});
