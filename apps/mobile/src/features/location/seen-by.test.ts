import {
  forgetMember,
  forgetMembers,
  knownMembers,
  newLiveViewers,
  rememberMembers,
  viewerNotices,
} from './seen-by';
import { DEFAULT_SHARING, type SharingSettings } from './sharing';
import { card, circleOf, memoryStore, somebody } from './test-support';

const NOW = 1_000_000;

describe('who can see my live location (Faz 9: new viewers)', () => {
  it('tells about newcomers to a group shared with, once, and nothing for a first look', () => {
    const [me, ada, bo] = [somebody(), somebody(), somebody()];
    const store = memoryStore();
    const group = circleOf([me, ada], { kind: 'family' });
    // First look (just joined): nothing to tell.
    expect(newLiveViewers(knownMembers(store), [group], DEFAULT_SHARING, me.userId, NOW)).toEqual(
      [],
    );
    rememberMembers(store, [group], me.userId);

    const grown = { ...group, members: [...group.members, card(bo, 'active')] };
    const told = newLiveViewers(knownMembers(store), [grown], DEFAULT_SHARING, me.userId, NOW);
    expect(told.map(({ viewer }) => viewer.userId)).toEqual([bo.userId]);
    rememberMembers(store, [grown], me.userId);
    expect(newLiveViewers(knownMembers(store), [grown], DEFAULT_SHARING, me.userId, NOW)).toEqual(
      [],
    );
  });

  it('tells nothing where the location does not go: not shared, a ghost, a friendship, an invitation', () => {
    const [me, ada, bo] = [somebody(), somebody(), somebody()];
    const store = memoryStore();
    const group = circleOf([me, ada], { kind: 'family' });
    const pair = circleOf([me], { kind: 'pair' });
    rememberMembers(store, [group, pair], me.userId);
    const grown = { ...group, members: [...group.members, card(bo, 'active')] };
    const invitedOnly = { ...group, members: [...group.members, card(bo, 'invited')] };
    const pairGrown = { ...pair, members: [...pair.members, card(ada, 'active')] };
    const off: SharingSettings = {
      ghost: 'off',
      circles: { [group.id]: { sharing: false, precision: 'exact', until: null } },
    };
    const known = knownMembers(store);
    expect(newLiveViewers(known, [grown], off, me.userId, NOW)).toEqual([]);
    expect(
      newLiveViewers(known, [grown], { ...DEFAULT_SHARING, ghost: 'hide' }, me.userId, NOW),
    ).toEqual([]);
    expect(newLiveViewers(known, [invitedOnly], DEFAULT_SHARING, me.userId, NOW)).toEqual([]);
    expect(newLiveViewers(known, [pairGrown], DEFAULT_SHARING, me.userId, NOW)).toEqual([]);
  });

  it('keeps what it knew of circles missing from a partial list, and forgets circles left', () => {
    const [me, ada] = [somebody(), somebody()];
    const store = memoryStore();
    const [a, b] = [circleOf([me, ada], { kind: 'family' }), circleOf([me], { kind: 'friends' })];
    rememberMembers(store, [a, b], me.userId);
    rememberMembers(store, [b], me.userId);
    expect(Object.keys(knownMembers(store)).sort()).toEqual([a.id, b.id].sort());
    forgetMembers(store, (circleId) => circleId === a.id);
    expect(Object.keys(knownMembers(store))).toEqual([b.id]);
  });
});

describe('new viewer notices (QA Faz 8 G9)', () => {
  it('tells about everyone who came in at once in one notice per circle and kind', () => {
    const [me, ...crowd] = [somebody(), somebody(), somebody(), somebody(), somebody()];
    const event = circleOf([me, ...crowd], { kind: 'event' });
    const group = circleOf([me, ...crowd.slice(0, 1)], { kind: 'family' });
    const cards = event.members.filter((member) => member.userId !== me.userId);
    const [first, second] = cards;
    if (first === undefined || second === undefined) throw new Error('members');
    const live = cards.map((viewer) => ({ circle: event, viewer }));
    // Two of them see the history too; one more sees only the history of the group.
    const history = [
      { circle: event, viewer: first },
      { circle: event, viewer: second },
      { circle: group, viewer: first },
    ];
    const notices = viewerNotices(live, history);
    expect(notices.map(({ kind, circle, viewers }) => [kind, circle.id, viewers.length])).toEqual([
      ['both', event.id, 2],
      ['live', event.id, 2],
      ['history', group.id, 1],
    ]);
  });
});

describe('a person no circle is shared with any more', () => {
  it('is no known member anywhere: met again, they are new and told about', () => {
    const [me, ada, bo] = [somebody(), somebody(), somebody()];
    const store = memoryStore();
    const group = circleOf([me, ada, bo]);
    const other = circleOf([me, ada]);
    rememberMembers(store, [group, other], me.userId);

    forgetMember(store, ada.userId);

    expect(knownMembers(store)).toEqual({
      [group.id]: [bo.userId],
      [other.id]: [],
    });
    expect(
      newLiveViewers(knownMembers(store), [group], DEFAULT_SHARING, me.userId, NOW).map(
        (entry) => entry.viewer.userId,
      ),
    ).toEqual([ada.userId]);
    // Nobody to forget: the vault is not written.
    const before = store.get('location:viewers:v1');
    forgetMember(store, 'nobody');
    expect(store.get('location:viewers:v1')).toBe(before);
  });
});
