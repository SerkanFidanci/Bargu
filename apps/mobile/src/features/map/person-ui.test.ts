import { encryptMessage, randomUuid } from '@bargu/crypto';

import { createReceiver } from '../location/receive';
import { buildEnvelopes } from '../location/send';
import { DEFAULT_SHARING } from '../location/sharing';
import {
  circleOf,
  exchangeKeys,
  GALATA,
  memoryStore,
  nth,
  somebody,
} from '../location/test-support';
import { personView } from './person-actions';
import { hoveredItem, opensBelow, RADIAL_RADIUS, radialPosition } from './person-focus';
import { placeName } from './place-name';

// The card's actions navigate; the router itself is not part of these tests.
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));

const ORIGIN = { x: 200, y: 400 };

describe('radial menu', () => {
  it('fans out above the avatar, or below it near the top of the screen', () => {
    expect(opensBelow(ORIGIN, 40)).toBe(false);
    expect(opensBelow({ x: 200, y: 90 }, 40)).toBe(true);
    for (const index of [0, 1, 2, 3]) {
      const above = radialPosition(ORIGIN, false, index);
      expect(above.y).toBeLessThan(ORIGIN.y);
      expect(Math.hypot(above.x - ORIGIN.x, above.y - ORIGIN.y)).toBeCloseTo(RADIAL_RADIUS, 5);
      expect(radialPosition(ORIGIN, true, index).y).toBeGreaterThan(ORIGIN.y);
    }
  });

  it('picks the item the finger slides onto, and nothing near the avatar', () => {
    for (const index of [0, 1, 2, 3]) {
      const item = radialPosition(ORIGIN, false, index);
      expect(hoveredItem(ORIGIN, false, item)).toBe(index);
      expect(hoveredItem(ORIGIN, true, radialPosition(ORIGIN, true, index))).toBe(index);
    }
    expect(hoveredItem(ORIGIN, false, { x: ORIGIN.x + 5, y: ORIGIN.y - 5 })).toBe(-1);
    // Straight down while the menu is above: no item there.
    expect(hoveredItem(ORIGIN, false, { x: ORIGIN.x, y: ORIGIN.y + RADIAL_RADIUS })).toBe(-1);
  });
});

describe('place names from the map', () => {
  const point = (lng: number, lat: number) => ({ type: 'Point', coordinates: [lng, lat] });

  it('names the nearest neighbourhood and town around a point', () => {
    const features = [
      { geometry: point(29.01, 41.05), properties: { kind: 'neighbourhood', name: 'Serencebey' } },
      { geometry: point(29.2, 41.2), properties: { kind: 'neighbourhood', name: 'Uzak' } },
      {
        geometry: point(29.0, 41.04),
        properties: { kind: 'locality', 'name:tr': 'Beşiktaş', name: 'Besiktas' },
      },
      { geometry: point(29.0, 41.04), properties: null },
    ];
    expect(placeName(features, { lng: 29.012, lat: 41.051 }, 'tr')).toBe('Serencebey, Beşiktaş');
    expect(placeName(features, { lng: 29.012, lat: 41.051 }, 'en')).toBe('Serencebey, Besiktas');
    expect(placeName([], { lng: 29, lat: 41 }, 'tr')).toBeNull();
  });
});

describe('a person on the map', () => {
  it('is shown from the circles shared with them, with the friendship as their profile', () => {
    const [me, ada] = [somebody(), somebody()];
    const pair = circleOf([me, ada], { kind: 'pair' });
    const group = circleOf([me, ada]);
    const view = personView(ada.userId, [group, pair], {});
    expect(view).toMatchObject({ userId: ada.userId, circleId: pair.id, location: null });
    expect(personView(randomUuid(), [group], {})).toBeNull();
  });

  it('pokes through the encrypted channel and the receiver hears who it was', () => {
    const [me, ada] = [somebody(), somebody()];
    const circle = circleOf([me, ada]);
    exchangeKeys(circle, [me, ada]);
    const pokes: [string, string][] = [];
    const receiver = createReceiver({
      keys: () => me.keys,
      circles: () => [circle],
      store: memoryStore,
      onBump: (circleId, userId) => {
        pokes.push([circleId, userId]);
      },
    });
    // Ada's location first (same key and sequence), then her poke.
    const location = nth(
      buildEnvelopes({
        fix: GALATA,
        battery: { level: 50, charging: false },
        circles: [circle],
        settings: DEFAULT_SHARING,
        keys: ada.keys,
        device: ada.device,
        now: Date.now(),
      }),
    );
    expect(receiver.receive(location)).toBe('shown');
    const { envelope } = encryptMessage({
      state: { senderKey: ada.keys.ownKey(circle), nextSeq: ada.keys.reserveSeq(circle) },
      sender: ada.device,
      payload: { kind: 'bump', ts: Date.now() },
    });
    expect(receiver.receive(envelope)).toBe('bumped');
    expect(pokes).toEqual([[circle.id, ada.userId]]);
    // The same poke again (replayed by the server) does nothing.
    expect(receiver.receive(envelope)).toBe('ignored');
  });
});
