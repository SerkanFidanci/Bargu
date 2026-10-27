import type { Avatar as AvatarData, Circle, MemberCard } from '@bargu/schemas';

import { memberName, partnerOf } from '../circles/names';
import {
  type Conversation,
  conversationTarget,
  type MessagesState,
  withoutConversation,
} from './messages';

/**
 * Someone this phone shares a lasting circle with (not an event): who one may write to alone
 * (docs/ADR/0035 §1). People met at an event talk in the event's own conversation.
 */
export interface Writable {
  userId: string;
  name: string;
  avatar: AvatarData | null;
}

/** The people this user shares an active, lasting circle with, once each, by name. */
export function writablePeople(circles: readonly Circle[], me: string | null): Writable[] {
  const people = new Map<string, Writable>();
  for (const circle of circles) {
    if (circle.myStatus !== 'active' || circle.kind === 'event') continue;
    for (const member of circle.members) {
      if (member.userId === me || member.status !== 'active' || people.has(member.userId)) continue;
      people.set(member.userId, {
        userId: member.userId,
        name: memberName(member),
        avatar: member.avatar,
      });
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The circles one writes to as a circle: groups, families and events. A pair's conversation is the
 * two people's own (docs/ADR/0035 §1), so a friendship shows as the person.
 */
export function writableCircles(circles: readonly Circle[]): Circle[] {
  return circles.filter((circle) => circle.myStatus === 'active' && circle.kind !== 'pair');
}

/** A member as this phone knows them, from any circle. */
export function memberIn(circles: readonly Circle[], userId: string): MemberCard | undefined {
  for (const circle of circles) {
    const found = circle.members.find((member) => member.userId === userId);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** What a conversation is called: the circle's name, or the person's. */
export function conversationName(
  conversation: Conversation,
  circles: readonly Circle[],
  me: string | null,
): string | null {
  const target = conversationTarget(conversation);
  if ('circleId' in target) {
    const circle = circles.find((candidate) => candidate.id === target.circleId);
    if (circle === undefined) return null;
    const partner = partnerOf(circle, me);
    return partner === undefined ? (circle.name ?? '') : memberName(partner);
  }
  const member = memberIn(circles, target.userId);
  return member === undefined ? null : memberName(member);
}

/** Whether the conversation can still be written to: the circle is active, the person shared. */
export function isOpen(
  conversation: Conversation,
  circles: readonly Circle[],
  me: string | null,
): boolean {
  const target = conversationTarget(conversation);
  if ('circleId' in target) {
    return writableCircles(circles).some((circle) => circle.id === target.circleId);
  }
  return writablePeople(circles, me).some((person) => person.userId === target.userId);
}

/**
 * The conversations with one person that no lasting circle backs any more go: the last one
 * shared was left, or only an event is (docs/ADR/0035 §8, QA-38 O2). The server deletes those
 * items as well. A circle's own conversation is not touched here.
 */
export function withoutLapsed<T extends MessagesState>(
  saved: T,
  circles: readonly Circle[],
  me: string | null,
): T {
  const writable = new Set(writablePeople(circles, me).map((person) => person.userId));
  let kept = saved;
  for (const conversation of new Set(saved.items.map((item) => item.conversation))) {
    const target = conversationTarget(conversation);
    if ('userId' in target && !writable.has(target.userId)) {
      kept = withoutConversation(kept, conversation);
    }
  }
  return kept;
}
