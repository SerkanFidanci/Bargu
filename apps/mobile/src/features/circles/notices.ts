import type { Circle } from '@bargu/schemas';
import { z } from 'zod';

import { memberName } from './names';

/** What the user was last shown of a circle: their own status and who else was active. */
export const seenSchema = z
  .object({ status: z.enum(['invited', 'active']), active: z.array(z.string()) })
  .strict();
export type Seen = z.infer<typeof seenSchema>;

/** Something other people did that the user should hear about (an in-app notice). */
export type Notice =
  | { kind: 'invited'; circleId: string; pair: boolean; from: string; circleName: string | null }
  | { kind: 'accepted'; circleId: string; name: string }
  | { kind: 'friendAdded'; circleId: string; name: string }
  | { kind: 'joined'; circleId: string; names: string[]; circleName: string | null }
  | { kind: 'keyChanged'; circleId: string; names: string[] };

export function seenOf(circle: Circle, isMe: (userId: string) => boolean): Seen {
  return {
    status: circle.myStatus,
    active: circle.members
      .filter((member) => member.status === 'active' && !isMe(member.userId))
      .map((member) => member.userId)
      .sort(),
  };
}

/**
 * Compares a circle with what the user saw of it last time. Only other people's doings count: a
 * new invitation, a friend who accepted, someone who joined. `previous` is null for a circle the
 * user has not seen before.
 */
export function noticesFor(
  previous: Seen | null,
  circle: Circle,
  isMe: (userId: string) => boolean,
): Notice[] {
  const others = circle.members.filter((member) => !isMe(member.userId));
  const pair = circle.kind === 'pair';
  if (circle.myStatus === 'invited') {
    if (previous?.status === 'invited') return [];
    const from = others[0];
    return [
      {
        kind: 'invited',
        circleId: circle.id,
        pair,
        from: from === undefined ? '?' : memberName(from),
        circleName: circle.name,
      },
    ];
  }
  const active = others.filter((member) => member.status === 'active');
  if (previous === null) {
    // Active in a pair never seen before: the other person used this user's friend code.
    const partner = active[0];
    return pair && partner !== undefined
      ? [{ kind: 'friendAdded', circleId: circle.id, name: memberName(partner) }]
      : [];
  }
  if (previous.status !== 'active') return [];
  const before = new Set(previous.active);
  const arrived = active.filter((member) => !before.has(member.userId));
  if (arrived.length === 0) return [];
  if (pair) {
    const [partner] = arrived;
    return partner === undefined
      ? []
      : [{ kind: 'accepted', circleId: circle.id, name: memberName(partner) }];
  }
  return [
    {
      kind: 'joined',
      circleId: circle.id,
      names: arrived.map((member) => memberName(member)),
      circleName: circle.name,
    },
  ];
}
