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
  /** Their username, for an invitation ("Buluş"); null when they have none yet. */
  username: string | null;
  avatar: MemberCard['avatar'];
  /** Their best location now, if any circle shares it with this phone. */
  location: ReceivedLocation | null;
  /** The friendship (pair circle), else the first group the two share. */
  circleId: string | null;
  /** Which of the two that is: the card names its button after it (UX düzeni 11). */
  circleKind: 'pair' | 'group' | null;
}

/** The card's and menu's name for the circle button: what it opens. */
export function circleActionLabel(person: Pick<PersonView, 'circleKind'>): 'friendship' | 'circle' {
  return person.circleKind === 'pair' ? 'friendship' : 'circle';
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
    username: card.username,
    avatar: card.avatar,
    location: bestPerPerson(mine)[0] ?? null,
    circleId: pair?.id ?? shared[0]?.id ?? null,
    circleKind: pair !== undefined ? 'pair' : shared[0] !== undefined ? 'group' : null,
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

/** Their location history (docs/ADR/0019), in the circle this phone sees them through. */
export function openHistory(person: PersonView): void {
  const circleId = person.location?.circleId ?? person.circleId;
  if (circleId === null) return;
  router.push({ pathname: '/history/[userId]', params: { userId: person.userId, circleId } });
}

export function openProfile(person: PersonView): void {
  if (person.circleId === null) return;
  router.push({ pathname: '/circle/[id]', params: { id: person.circleId } });
}

export interface ActionDeps {
  poke: (person: PersonView) => void;
  /** This person's notification switches (mute-sheet.tsx). */
  notifications: (person: PersonView) => void;
}

export function runPersonAction(action: PersonAction, person: PersonView, deps: ActionDeps): void {
  switch (action) {
    case 'poke':
      deps.poke(person);
      return;
    case 'directions':
      if (person.location !== null) void openDirections(person.location.loc).catch(() => undefined);
      return;
    case 'history':
      openHistory(person);
      return;
    case 'profile':
      openProfile(person);
      return;
    case 'notifications':
      deps.notifications(person);
      return;
  }
}
