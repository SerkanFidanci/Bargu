import { encryptMessage } from '@bargu/crypto';
import type { Circle, MessageEnvelope } from '@bargu/schemas';

import { forgetCheckedBundles } from '../keys/bundle-cache';
import { createReceiver, useLocations } from './receive';
import { buildEnvelopes, type Fix } from './send';
import { DEFAULT_SHARING } from './sharing';
import {
  circleOf,
  exchangeKeys,
  GALATA,
  memoryStore,
  moved,
  nth,
  type Person,
  somebody,
} from './test-support';

/**
 * What the phone does when the app opens or the live connection comes back, and while a friend
 * moves without stopping (the owner's test friend: a location every 5 seconds). Measured as
 * counts, since Jest cannot time Hermes: every counted call is one the phone's JS thread makes,
 * and signature checks and bundle checks are the expensive ones (docs/ADR/0007: pure-JS curve
 * arithmetic on Hermes is slow; the signature itself is native, the bundle's key check is not).
 */
const calls = { bundles: 0, decrypts: 0 };
jest.mock('@bargu/crypto', () => {
  const actual = jest.requireActual<typeof import('@bargu/crypto')>('@bargu/crypto');
  return {
    ...actual,
    verifyDeviceKeyBundle: (...args: Parameters<typeof actual.verifyDeviceKeyBundle>) => {
      calls.bundles += 1;
      return actual.verifyDeviceKeyBundle(...args);
    },
    decryptMessage: (...args: Parameters<typeof actual.decryptMessage>) => {
      calls.decrypts += 1;
      return actual.decryptMessage(...args);
    },
  };
});

const NOW = 1_800_000_000_000;
const BATTERY = { level: 64, charging: false };

interface World {
  owner: Person;
  friends: Person[];
  circles: Circle[];
}

/** The owner with `circleCount` circles, the same `friendCount` friends in each of them. */
function world(circleCount: number, friendCount: number): World {
  const owner = somebody();
  const friends = Array.from({ length: friendCount }, () => somebody());
  const circles = Array.from({ length: circleCount }, () => {
    const circle = circleOf([owner, ...friends]);
    exchangeKeys(circle, [owner, ...friends]);
    return circle;
  });
  return { owner, friends, circles };
}

function locationsOf(friend: Person, circles: Circle[], fix: Fix): MessageEnvelope[] {
  return buildEnvelopes({
    fix,
    battery: BATTERY,
    circles,
    settings: DEFAULT_SHARING,
    keys: friend.keys,
    device: friend.device,
    now: NOW,
  });
}

function statusOf(friend: Person, circle: Circle): MessageEnvelope {
  return encryptMessage({
    state: { senderKey: friend.keys.ownKey(circle), nextSeq: friend.keys.reserveSeq(circle) },
    sender: friend.device,
    payload: { kind: 'status', emoji: '🙂', expiresAt: NOW + 3_600_000, ts: NOW },
  }).envelope;
}

function receiverFor(owner: Person, circles: Circle[], store = owner.store) {
  return createReceiver({ keys: () => owner.keys, circles: () => circles, store: () => store });
}

beforeEach(() => {
  useLocations.setState({}, true);
  calls.bundles = 0;
  calls.decrypts = 0;
});

describe('the snapshot after opening the app or reconnecting', () => {
  it('opens nothing it has already opened (a restart or a short drop sees the same messages)', async () => {
    const { owner, friends, circles } = world(4, 3);
    const envelopes = friends.flatMap((friend) => locationsOf(friend, circles, GALATA));
    const statuses = friends.flatMap((friend) => circles.map((circle) => statusOf(friend, circle)));
    const receiver = receiverFor(owner, circles);
    for (const envelope of [...envelopes, ...statuses]) receiver.receive(envelope);
    expect(Object.keys(useLocations.getState())).toHaveLength(12);

    // The phone starts again, or the connection comes back: the relay hands over the same ones.
    forgetCheckedBundles();
    calls.bundles = 0;
    calls.decrypts = 0;
    const next = receiverFor(owner, circles);
    next.restore();
    await next.receiveSnapshot(envelopes);
    for (const envelope of statuses) expect(next.receive(envelope)).toBe('ignored');
    expect(calls).toEqual({ bundles: 0, decrypts: 0 });
    // What was on the map stays there.
    expect(Object.keys(useLocations.getState())).toHaveLength(12);
  });

  it('checks the sender once, not once per message', () => {
    const { owner, friends, circles } = world(1, 1);
    // What setting the circle up checked is forgotten: this counts what the messages cost.
    forgetCheckedBundles();
    calls.bundles = 0;
    const receiver = receiverFor(owner, circles);
    for (let index = 0; index < 20; index += 1) {
      const fix = moved(GALATA, index * 40, NOW + index * 5_000);
      expect(receiver.receive(nth(locationsOf(nth(friends), circles, fix)))).toBe('shown');
    }
    // Every message is opened (one signature, one decryption) ...
    expect(calls.decrypts).toBe(20);
    // ... but the sender's bundle (its key check is pure JavaScript) is checked once.
    expect(calls.bundles).toBeLessThanOrEqual(1);
  });

  it('is opened in slices with a pause between them, so the screen keeps moving', async () => {
    const { owner, friends, circles } = world(5, 4);
    const envelopes = friends.flatMap((friend) => locationsOf(friend, circles, GALATA));
    expect(envelopes).toHaveLength(20);
    const pauses = jest.fn(() => Promise.resolve());
    const receiver = createReceiver({
      keys: () => owner.keys,
      circles: () => circles,
      store: () => owner.store,
      pause: pauses,
    });
    let shownBeforeFirstPause = -1;
    pauses.mockImplementationOnce(() => {
      shownBeforeFirstPause = Object.keys(useLocations.getState()).length;
      return Promise.resolve();
    });
    await receiver.receiveSnapshot(envelopes);
    expect(Object.keys(useLocations.getState())).toHaveLength(20);
    // Not all twenty in one go: a pause after each slice of a few.
    expect(shownBeforeFirstPause).toBeGreaterThan(0);
    expect(shownBeforeFirstPause).toBeLessThan(20);
    expect(pauses.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

describe('a snapshot opened in slices while the connection is live', () => {
  it('does not drop a location that came in live between two slices', async () => {
    const { owner, friends, circles } = world(5, 3);
    const [early, late] = friends;
    const snapshot = [early, late].flatMap((friend) =>
      friend === undefined ? [] : locationsOf(friend, circles, GALATA),
    );
    // A third friend's location, newer than the snapshot, arrives while the slices are opened.
    const live = nth(locationsOf(nth(friends, 2), circles, moved(GALATA, 80, NOW + 1_000)));
    const receiver = createReceiver({
      keys: () => owner.keys,
      circles: () => circles,
      store: () => owner.store,
      pause: () => {
        receiver.receive(live);
        return Promise.resolve();
      },
    });
    await receiver.receiveSnapshot(snapshot);
    const people = new Set(Object.values(useLocations.getState()).map((entry) => entry.userId));
    expect(people.has(nth(friends, 2).userId)).toBe(true);
    expect(people.size).toBe(3);
  });

  it('stops when the account signs out meanwhile, so nothing reaches the next one', async () => {
    const { owner, friends, circles } = world(5, 2);
    const snapshot = friends.flatMap((friend) => locationsOf(friend, circles, GALATA));
    expect(snapshot).toHaveLength(10);
    const receiver = createReceiver({
      keys: () => owner.keys,
      circles: () => circles,
      store: () => owner.store,
      pause: () => {
        receiver.reset();
        return Promise.resolve();
      },
    });
    await receiver.receiveSnapshot(snapshot);
    // Only the first slice was opened, and reset() emptied the map after it.
    expect(useLocations.getState()).toEqual({});
  });
});

describe('the replay state is written when it changed, not when a message was refused', () => {
  it('writes once per message opened and not at all for one refused', () => {
    const { owner, friends, circles } = world(1, 1);
    const writes: string[] = [];
    const store = memoryStore();
    const counting = {
      ...store,
      set: (key: string, value: string) => {
        writes.push(key);
        store.set(key, value);
      },
    };
    // The owner's keys live in the same store, as in the app.
    const receiver = createReceiver({
      keys: () => owner.keys,
      circles: () => circles,
      store: () => counting,
    });
    const first = nth(locationsOf(nth(friends), circles, GALATA));
    expect(receiver.receive(first)).toBe('shown');
    const afterFirst = writes.filter((key) => key === 'replay:v1').length;
    expect(afterFirst).toBe(1);
    expect(receiver.receive(first)).toBe('ignored');
    expect(writes.filter((key) => key === 'replay:v1')).toHaveLength(afterFirst);
  });
});

describe('thirty minutes of a friend who never stops (a location every 5 seconds)', () => {
  it('keeps what the phone holds the same size from the first message to the last', () => {
    const { owner, friends, circles } = world(2, 1);
    const receiver = receiverFor(owner, circles);
    const bot = nth(friends);
    const sizes: { keys: number; bytes: number; replay: number; locations: number }[] = [];
    let notified = 0;
    const unsubscribe = useLocations.subscribe(() => {
      notified += 1;
    });
    const total = (30 * 60) / 5;
    // Speeds of the tour: walking, running, cycling, driving, a race car, a train, a plane.
    const speeds = [1.4, 3, 6.1, 14, 39, 64, 89];
    for (let index = 0; index < total; index += 1) {
      const band = Math.floor(index / 18) % speeds.length;
      const fix: Fix = {
        ...moved(GALATA, index * 3, NOW + index * 5_000),
        spd: speeds[band] ?? 1,
        hdg: (index * 7) % 360,
      };
      for (const envelope of locationsOf(bot, circles, fix)) receiver.receive(envelope);
      if (index === 1 || index === total / 2 || index === total - 1) {
        const bytes = owner.store
          .keys()
          .reduce((sum, key) => sum + (owner.store.get(key) ?? '').length, 0);
        sizes.push({
          keys: owner.store.keys().length,
          bytes,
          replay: (owner.store.get('replay:v1') ?? '').length,
          locations: Object.keys(useLocations.getState()).length,
        });
      }
    }
    unsubscribe();
    const [early, middle, last] = sizes;
    expect(last?.keys).toBe(early?.keys);
    expect(middle?.keys).toBe(early?.keys);
    // A few kilobytes of replay state, however long it runs (a window of 64 per sender and epoch).
    expect(last?.replay).toBeLessThan(2_000 * 2);
    expect(last?.bytes ?? Infinity).toBeLessThan((early?.bytes ?? 0) * 1.5);
    // One entry per circle for the friend, never a history of them.
    expect(last?.locations).toBe(2);
    // The map was told once for each location that went in: no more, no fewer.
    expect(notified).toBe(total * 2);
  });
});
