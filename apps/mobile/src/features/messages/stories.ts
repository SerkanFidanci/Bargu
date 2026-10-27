import type { Circle } from '@bargu/schemas';

import { storiesOf } from './messages';

/**
 * Who a story goes to (docs/ADR/0035 §1, §8): the user's active circles with someone else in them.
 * "Hikaye (bütün çemberlerim)" leaves events out (people seen once may be there); "Çember seç"
 * offers them too.
 */
export function storyCircles(
  circles: readonly Circle[],
  me: string | null,
  options: { events: boolean } = { events: false },
): Circle[] {
  return circles.filter(
    (circle) =>
      circle.myStatus === 'active' &&
      (options.events || circle.kind !== 'event') &&
      circle.members.some((member) => member.userId !== me && member.status === 'active'),
  );
}

/**
 * Whose pin wears a story ring, as a short text (`<userId>:n` new, `<userId>:s` seen, comma
 * separated): a store selector that changes only when a ring does.
 */
export function storyRingKey(saved: Parameters<typeof storiesOf>[0], me: string | null): string {
  return storiesOf(saved, me)
    .map((person) => `${person.userId}:${person.unseen ? 'n' : 's'}`)
    .join(',');
}

/** The rings back from their text: whose pin, new or seen. */
export function storyRingsOf(key: string): Map<string, 'new' | 'seen'> {
  const rings = new Map<string, 'new' | 'seen'>();
  for (const part of key.split(',')) {
    const [userId, state] = part.split(':');
    if (userId === undefined || userId === '') continue;
    rings.set(userId, state === 'n' ? 'new' : 'seen');
  }
  return rings;
}
