import type { Circle, MemberCard } from '@bargu/schemas';

/** For a pair: the other person. For a group: undefined. */
export function partnerOf(circle: Circle, myUserId: string | null): MemberCard | undefined {
  if (circle.kind !== 'pair') return undefined;
  return circle.members.find((member) => member.userId !== myUserId);
}

/** "@username", or undefined for someone without one yet. */
export function handleOf(member: Pick<MemberCard, 'username'> | undefined): string | undefined {
  const username = member?.username ?? null;
  return username === null ? undefined : `@${username}`;
}

/** The name to show for a member: display name, else @username. */
export function memberName(member: Pick<MemberCard, 'displayName' | 'username'>): string {
  return member.displayName ?? (member.username === null ? '?' : `@${member.username}`);
}

/** Someone the user can invite into a group with one tap: an accepted friend with a username. */
export interface Friend {
  userId: string;
  username: string;
  name: string;
  avatar: MemberCard['avatar'];
}

/** The user's friends (both sides of a pair active), sorted by name. */
export function friendsOf(circles: readonly Circle[], myUserId: string | null): Friend[] {
  return circles
    .flatMap((circle) => {
      if (circle.kind !== 'pair' || circle.myStatus !== 'active') return [];
      const partner = partnerOf(circle, myUserId);
      if (partner?.status !== 'active' || partner.username === null) return [];
      return [
        {
          userId: partner.userId,
          username: partner.username,
          name: memberName(partner),
          avatar: partner.avatar,
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'));
}
