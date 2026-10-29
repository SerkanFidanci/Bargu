import { personShareOf, untilChoices, withPersonShare } from './person-share';
import { endedFriendShares } from './share-ends';
import {
  DEFAULT_SHARING,
  isFrozenFor,
  isSharingWith,
  type SharingSettings,
  timedShareOver,
} from './sharing';
import { circleOf, somebody } from './test-support';

const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;
const me = somebody();
const ayse = somebody();
const pair = circleOf([me, ayse], { kind: 'pair', name: null });
const group = circleOf([me, ayse], { kind: 'friends', name: 'Kulüp' });

const set = (choice: Parameters<typeof withPersonShare>[2], from = DEFAULT_SHARING) =>
  withPersonShare(from, pair.id, choice);

describe("one friend's sharing (docs/ADR/0038)", () => {
  it('shows with no end, until a time, frozen or not at all, and says which', () => {
    expect(personShareOf(set({ mode: 'always' }), pair.id, NOW)).toEqual({
      mode: 'always',
      until: null,
    });
    expect(personShareOf(set({ mode: 'until', until: NOW + HOUR }), pair.id, NOW)).toEqual({
      mode: 'until',
      until: NOW + HOUR,
    });
    expect(personShareOf(set({ mode: 'frozen' }), pair.id, NOW).mode).toBe('frozen');
    expect(personShareOf(set({ mode: 'off' }), pair.id, NOW).mode).toBe('off');
    // A time gone by is not shown any more.
    expect(personShareOf(set({ mode: 'until', until: NOW - 1 }), pair.id, NOW).mode).toBe('off');
  });

  it('keeps how precise and the history, and touches no other circle', () => {
    const before: SharingSettings = {
      ...DEFAULT_SHARING,
      circles: {
        [pair.id]: { sharing: true, precision: 'neighborhood', until: null, history: true },
        [group.id]: { sharing: true, precision: 'exact', until: null },
      },
    };
    const after = set({ mode: 'frozen' }, before);
    expect(after.circles[pair.id]).toEqual({
      sharing: true,
      precision: 'neighborhood',
      until: null,
      history: true,
      frozen: true,
    });
    expect(after.circles[group.id]).toBe(before.circles[group.id]);
    // Shown again: no longer frozen.
    expect(set({ mode: 'always' }, after).circles[pair.id]?.frozen).toBeUndefined();
  });

  it('frozen sends nothing new and is not taken back; a ghost is above it all', () => {
    const frozen = set({ mode: 'frozen' });
    expect(isSharingWith(frozen, pair.id, NOW)).toBe(false);
    expect(isFrozenFor(frozen, pair.id, NOW)).toBe(true);
    expect(isFrozenFor({ ...frozen, ghost: 'hide' }, pair.id, NOW)).toBe(false);
    expect(isFrozenFor(set({ mode: 'always' }), pair.id, NOW)).toBe(false);
  });

  it('tells a timed share that ran out from one turned off or hidden by a ghost', () => {
    const timed = set({ mode: 'until', until: NOW - 1 });
    expect(timedShareOver(timed, pair.id, NOW)).toBe(true);
    expect(timedShareOver(set({ mode: 'off' }), pair.id, NOW)).toBe(false);
    expect(timedShareOver({ ...timed, ghost: 'hide' }, pair.id, NOW)).toBe(false);
    expect(timedShareOver(set({ mode: 'until', until: NOW + 1 }), pair.id, NOW)).toBe(false);
  });

  it('offers the half hours from at least half an hour on, for six hours', () => {
    const at = Date.UTC(2026, 9, 29, 18, 50);
    const ends = untilChoices(at);
    expect(ends).toHaveLength(12);
    expect(new Date(ends[0] ?? 0).toISOString()).toBe('2026-10-29T19:30:00.000Z');
    expect(new Date(ends[11] ?? 0).toISOString()).toBe('2026-10-30T01:00:00.000Z');
  });

  it("tells the friendships whose time ran out since the last look, once, and no group's", () => {
    const both: SharingSettings = {
      ...DEFAULT_SHARING,
      circles: {
        [pair.id]: { sharing: true, precision: 'exact', until: NOW - 1_000 },
        [group.id]: { sharing: true, precision: 'exact', until: NOW - 1_000 },
      },
    };
    const circles = [pair, group];
    expect(endedFriendShares(both, circles, NOW - 60_000, NOW).map((c) => c.id)).toEqual([pair.id]);
    expect(endedFriendShares(both, circles, NOW - 500, NOW)).toEqual([]);
    expect(endedFriendShares({ ...both, ghost: 'freeze' }, circles, NOW - 60_000, NOW)).toEqual([]);
  });
});
