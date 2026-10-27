import { randomUuid } from '@bargu/crypto';
import type { Circle, MemberCard } from '@bargu/schemas';

import {
  type ChatItem,
  circleConversation,
  EMPTY_MESSAGES,
  personConversation,
  withItem,
} from './messages';
import { withoutLapsed, writablePeople } from './names';

const ME = randomUuid();
const FRIEND = randomUuid();
const MET = randomUuid();

const member = (userId: string, displayName: string): MemberCard => ({
  userId,
  role: 'member',
  status: 'active',
  username: null,
  displayName,
  avatar: null,
  device: null,
});
const circle = (kind: Circle['kind'], ...people: [string, string][]): Circle => ({
  id: randomUuid(),
  kind,
  name: kind,
  epoch: 1,
  epochStartedAt: 0,
  myRole: 'member',
  myStatus: 'active',
  members: [member(ME, 'Ben'), ...people.map(([id, name]) => member(id, name))],
});
const item = (conversation: ChatItem['conversation'], from = ME): ChatItem => ({
  id: randomUuid(),
  conversation,
  from,
  at: Date.now(),
  kind: 'text',
  text: 'selam',
  state: 'sent',
});

describe('who one writes to alone (docs/ADR/0035 §1, QA-38 O2)', () => {
  const family = circle('family', [FRIEND, 'Ali']);
  const event = circle('event', [MET, 'Ayşe'], [FRIEND, 'Ali']);

  it('is someone a lasting circle is shared with, never someone met only at an event', () => {
    expect(writablePeople([family, event], ME).map((person) => person.userId)).toEqual([FRIEND]);
    expect(writablePeople([event], ME)).toEqual([]);
  });

  it('loses their conversation with the last lasting circle; a circle’s own is kept', () => {
    const withFriend = item(personConversation(FRIEND));
    const withMet = item(personConversation(MET), MET);
    const inEvent = item(circleConversation(event.id), MET);
    const state = [withFriend, withMet, inEvent].reduce(
      (saved, next) => withItem(saved, next),
      EMPTY_MESSAGES,
    );
    const kept = withoutLapsed(state, [family, event], ME);
    expect(kept.items.map((each) => each.id).sort()).toEqual([withFriend.id, inEvent.id].sort());
    expect(withoutLapsed(kept, [event], ME).items).toEqual([inEvent]);
    expect(withoutLapsed(kept, [family, event], ME)).toBe(kept);
  });
});
