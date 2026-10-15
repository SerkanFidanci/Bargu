import type { Circle, CircleCreate } from '@bargu/schemas';

import { circleOf, somebody } from '../location/test-support';
import { startMeetingWith } from './quick-meeting';

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;

describe('a meeting from a friend’s card (Faz 9)', () => {
  it('is an event of three hours with the friend invited, named after them', async () => {
    const me = somebody();
    const created: CircleCreate[] = [];
    const invited: [string, string][] = [];
    const adopted: string[] = [];
    const event = circleOf([me], { kind: 'event' });
    const result = await startMeetingWith(
      { username: 'ada', name: 'Ada' },
      (name) => `${name} ile buluşma`,
      {
        create: (input) => {
          created.push(input);
          return Promise.resolve(event);
        },
        invite: (id, username) => {
          invited.push([id, username]);
          return Promise.resolve({ ...event, epoch: 2 } satisfies Circle);
        },
        adopt: (circle) => {
          adopted.push(`${circle.id}:${String(circle.epoch)}`);
        },
      },
      NOW,
    );
    expect(created).toEqual([{ kind: 'event', name: 'Ada ile buluşma', endsAt: NOW + 3 * HOUR }]);
    expect(invited).toEqual([[event.id, 'ada']]);
    expect(adopted).toEqual([`${event.id}:1`, `${event.id}:2`]);
    expect(result.epoch).toBe(2);
  });

  it('keeps a long name within the limit of a circle name', async () => {
    const created: CircleCreate[] = [];
    const event = circleOf([somebody()], { kind: 'event' });
    await startMeetingWith(
      { username: 'x', name: 'Çok çok uzun bir görünen ad olan arkadaşım' },
      (name) => `${name} ile buluşma`,
      {
        create: (input) => {
          created.push(input);
          return Promise.resolve(event);
        },
        invite: () => Promise.resolve(event),
        adopt: () => undefined,
      },
      NOW,
    );
    expect(created[0]?.name.length).toBeLessThanOrEqual(40);
  });
});
