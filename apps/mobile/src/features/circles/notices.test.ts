import type { Circle, MemberCard } from '@bargu/schemas';

import { friendsOf } from './names';
import { noticesFor, seenOf } from './notices';

const ME = '0190a8a0-0000-7000-8000-000000000001';
const ALI = '0190a8a0-0000-7000-8000-000000000002';
const VELI = '0190a8a0-0000-7000-8000-000000000003';
const isMe = (userId: string) => userId === ME;

function member(userId: string, name: string, status: MemberCard['status']): MemberCard {
  return {
    userId,
    role: 'member',
    status,
    username: name.toLowerCase(),
    displayName: name,
    avatar: null,
    device: null,
  };
}

function circle(
  kind: Circle['kind'],
  myStatus: Circle['myStatus'],
  others: MemberCard[],
  name: string | null = kind === 'pair' ? null : 'Aile',
): Circle {
  return {
    id: '0190a8a0-0000-7000-8000-0000000000c1',
    kind,
    name,
    epoch: 2,
    epochStartedAt: 0,
    myRole: 'member',
    myStatus,
    members: [member(ME, 'Ben', myStatus), ...others],
  };
}

describe('noticesFor', () => {
  it('announces a new friend request or invitation once', () => {
    const request = circle('pair', 'invited', [member(ALI, 'Ali', 'active')]);
    expect(noticesFor(null, request, isMe)).toEqual([
      { kind: 'invited', circleId: request.id, pair: true, from: 'Ali', circleName: null },
    ]);
    // Already shown: not again.
    expect(noticesFor(seenOf(request, isMe), request, isMe)).toEqual([]);

    const invitation = circle('family', 'invited', [member(ALI, 'Ali', 'active')]);
    expect(noticesFor(null, invitation, isMe)).toMatchObject([
      { kind: 'invited', pair: false, from: 'Ali', circleName: 'Aile' },
    ]);
  });

  it('announces a friend who accepted, and a friend who scanned the user’s code', () => {
    const sent = circle('pair', 'active', [member(ALI, 'Ali', 'invited')]);
    const accepted = circle('pair', 'active', [member(ALI, 'Ali', 'active')]);
    expect(noticesFor(seenOf(sent, isMe), accepted, isMe)).toEqual([
      { kind: 'accepted', circleId: accepted.id, name: 'Ali' },
    ]);
    expect(noticesFor(null, accepted, isMe)).toEqual([
      { kind: 'friendAdded', circleId: accepted.id, name: 'Ali' },
    ]);
  });

  it('announces who joined a group, and nothing for the user’s own new group', () => {
    const before = circle('family', 'active', [
      member(ALI, 'Ali', 'active'),
      member(VELI, 'Veli', 'invited'),
    ]);
    const after = circle('family', 'active', [
      member(ALI, 'Ali', 'active'),
      member(VELI, 'Veli', 'active'),
    ]);
    expect(noticesFor(seenOf(before, isMe), after, isMe)).toEqual([
      { kind: 'joined', circleId: after.id, names: ['Veli'], circleName: 'Aile' },
    ]);
    expect(noticesFor(null, after, isMe)).toEqual([]);
    // Someone leaving is not announced.
    const left = circle('family', 'active', [member(ALI, 'Ali', 'active')]);
    expect(noticesFor(seenOf(after, isMe), left, isMe)).toEqual([]);
  });
});

describe('friendsOf', () => {
  it('lists accepted friends with a username, sorted by name', () => {
    const friends = friendsOf(
      [
        { ...circle('pair', 'active', [member(VELI, 'Veli', 'active')]), id: 'a' },
        { ...circle('pair', 'active', [member(ALI, 'Ali', 'active')]), id: 'b' },
        // A request not yet accepted, and a group: not friends to pick.
        { ...circle('pair', 'active', [member(VELI, 'Can', 'invited')]), id: 'c' },
        { ...circle('family', 'active', [member(ALI, 'Ali', 'active')]), id: 'd' },
      ],
      ME,
    );
    expect(friends.map((friend) => friend.name)).toEqual(['Ali', 'Veli']);
    expect(friends[0]).toMatchObject({ userId: ALI, username: 'ali' });
  });
});
