import type { Circle } from '@bargu/schemas';

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
