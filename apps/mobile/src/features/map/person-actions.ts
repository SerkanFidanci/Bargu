import type { Circle, LocPayload, MemberCard } from '@bargu/schemas';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

import { handleOf, memberName } from '../circles/names';
import { bestPerPerson, type ReceivedLocation } from '../location/receive';
import type { PersonAction } from './person-focus';

/** A person as the card and the menu show them. */
export interface PersonView {
  userId: string;
  name: string;
  handle: string | undefined;
  avatar: MemberCard['avatar'];
  /** Their best location now, if any circle shares it with this phone. */
  location: ReceivedLocation | null;
  /** The friendship (pair circle), else the first group the two share. */
  circleId: string | null;
}

/** Everything the screens know about one person, from the circles and received locations. */
export function personView(
  userId: string,
  circles: readonly Circle[],
  locations: Readonly<Record<string, ReceivedLocation>>,
): PersonView | null {
  const shared = circles.filter(
    (circle) =>
      circle.myStatus === 'active' && circle.members.some((member) => member.userId === userId),
  );
  const card = shared.flatMap((circle) => circle.members).find((m) => m.userId === userId);
  if (card === undefined) return null;
  const pair = shared.find((circle) => circle.kind === 'pair');
  const mine = Object.fromEntries(
    Object.entries(locations).filter(([, entry]) => entry.userId === userId),
  );
  return {
    userId,
    name: memberName(card),
    handle: handleOf(card),
    avatar: card.avatar,
    location: bestPerPerson(mine)[0] ?? null,
    circleId: pair?.id ?? shared[0]?.id ?? null,
  };
}

/**
 * Directions in the phone's own maps app. The friend's location leaves Bargu only here, because
 * the user asked for it, and without their name.
 */
export async function openDirections(loc: Pick<LocPayload, 'lat' | 'lng'>): Promise<void> {
  const point = `${String(loc.lat)},${String(loc.lng)}`;
  const url = Platform.OS === 'ios' ? `maps:?daddr=${point}` : `geo:${point}?q=${point}`;
  await Linking.openURL(url);
}

export function openProfile(person: PersonView): void {
  if (person.circleId === null) return;
  router.push({ pathname: '/circle/[id]', params: { id: person.circleId } });
}

export interface ActionDeps {
  poke: (person: PersonView) => void;
  /** Not here yet (per-person notification settings come with Faz 7). */
  soon: () => void;
}

export function runPersonAction(action: PersonAction, person: PersonView, deps: ActionDeps): void {
  switch (action) {
    case 'poke':
      deps.poke(person);
      return;
    case 'directions':
      if (person.location !== null) void openDirections(person.location.loc).catch(() => undefined);
      return;
    case 'profile':
      openProfile(person);
      return;
    case 'notifications':
      deps.soon();
      return;
  }
}
