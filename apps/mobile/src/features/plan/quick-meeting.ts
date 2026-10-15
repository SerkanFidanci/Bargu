import type { Circle, CircleCreate } from '@bargu/schemas';

import { eventEndAt } from '../circles/event-time';

/** How long a meeting started from a friend's card lasts (it can be ended earlier). */
const MEETING_END = 'hours3' as const;
/** Circle names are at most this long (packages/schemas circleNameSchema). */
const NAME_MAX = 40;

export interface QuickMeetingDeps {
  create: (input: CircleCreate) => Promise<Circle>;
  invite: (circleId: string, username: string) => Promise<Circle>;
  adopt: (circle: Circle) => void;
  /** Ends an event at once (its admin): a meeting whose invitation did not go out. */
  end: (circleId: string) => Promise<void>;
  /** Forgets an ended event on this phone. */
  drop: (circleId: string) => void;
}

/**
 * "Buluş" on a friend's card (the project owner's request, Faz 9): an event with that friend,
 * started in one tap. The user is its admin, so they set the time and place right after; the
 * friend gets an invitation. It ends on its own in three hours, and everything goes with it
 * (docs/ADR/0017).
 */
export async function startMeetingWith(
  friend: { username: string; name: string },
  name: (friend: string) => string,
  deps: QuickMeetingDeps,
  now: number,
): Promise<Circle> {
  const endsAt = eventEndAt(MEETING_END, now);
  if (endsAt === null) throw new Error('no end for a meeting now');
  const title = Array.from(name(friend.name)).slice(0, NAME_MAX).join('').trim();
  const event = await deps.create({ kind: 'event', name: title, endsAt });
  deps.adopt(event);
  try {
    const invited = await deps.invite(event.id, friend.username);
    deps.adopt(invited);
    return invited;
  } catch (error) {
    // No meeting without the friend (QA 3a-B1): it goes again, and the caller says why.
    await deps.end(event.id).catch(() => undefined);
    deps.drop(event.id);
    throw error;
  }
}
