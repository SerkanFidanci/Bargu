import { encryptMessage } from '@bargu/crypto';
import { type Circle, STATE_WHY, type StatePayload } from '@bargu/schemas';

import { createReceiver, useLocations } from './receive';
import { buildEnvelopes, locPayload } from './send';
import { DEFAULT_SHARING } from './sharing';
import {
  circleOf,
  exchangeKeys,
  GALATA,
  memoryStore,
  nth,
  type Person,
  somebody,
} from './test-support';
import {
  newestState,
  type ReceivedState,
  sinceTime,
  STALE_AFTER_MS,
  useStates,
  whyShown,
} from './why';

// "Neden eski?" (docs/ADR/0028): what a friend's screen says next to an old location.
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

const stateOf = (overrides: Partial<ReceivedState> = {}): ReceivedState => ({
  circleId: 'c',
  userId: 'u',
  why: 'saver',
  since: NOW - 30 * MINUTE,
  ts: NOW - 2 * MINUTE,
  receivedAt: NOW - 2 * MINUTE,
  ...overrides,
});

describe('what an old location says (whyShown)', () => {
  const old = { ts: NOW - 40 * MINUTE };

  it('says nothing next to a fresh location, whatever was said before', () => {
    expect(whyShown({ loc: { ts: NOW - 9 * MINUTE }, state: stateOf(), now: NOW })).toBeNull();
    expect(whyShown({ loc: { ts: NOW }, state: undefined, now: NOW })).toBeNull();
  });

  it.each(STATE_WHY.filter((why) => why !== 'none'))(
    'gives the reason %s, since when it began, while it is renewed',
    (why) => {
      expect(whyShown({ loc: old, state: stateOf({ why }), now: NOW })).toEqual({
        kind: why,
        since: NOW - 30 * MINUTE,
      });
    },
  );

  it('infers "offline" after two missed heartbeats, since the last message', () => {
    // Silence, nothing ever said: since the location.
    expect(whyShown({ loc: old, state: undefined, now: NOW })).toEqual({
      kind: 'offline',
      since: old.ts,
    });
    // Just under ten minutes of silence is not yet.
    const lately = { ts: NOW - STALE_AFTER_MS + 1 };
    const heardNine = stateOf({ why: 'none', ts: NOW - 9 * MINUTE });
    expect(whyShown({ loc: { ts: NOW - 11 * MINUTE }, state: heardNine, now: NOW })).toBeNull();
    expect(whyShown({ loc: lately, state: undefined, now: NOW })).toBeNull();
    // Ten minutes: the first moment it shows.
    expect(whyShown({ loc: { ts: NOW - STALE_AFTER_MS }, state: undefined, now: NOW })).toEqual({
      kind: 'offline',
      since: NOW - STALE_AFTER_MS,
    });
  });

  it('lets a reason beat "offline" while it is renewed, and lapse into it when it is not', () => {
    // The location is 40 minutes old, but the phone said "battery saver" two minutes ago.
    expect(whyShown({ loc: old, state: stateOf(), now: NOW })?.kind).toBe('saver');
    // Not renewed for ten minutes (a phone that died in battery saver): offline, since the last word.
    const lapsed = stateOf({ ts: NOW - STALE_AFTER_MS });
    expect(whyShown({ loc: old, state: lapsed, now: NOW })).toEqual({
      kind: 'offline',
      since: NOW - STALE_AFTER_MS,
    });
  });

  it('says nothing for someone who just said the reason is over', () => {
    const over = stateOf({ why: 'none', ts: NOW - MINUTE });
    expect(whyShown({ loc: old, state: over, now: NOW })).toBeNull();
    // …but if they then go quiet it is "offline", since that last word.
    expect(whyShown({ loc: old, state: over, now: NOW + 10 * MINUTE })).toEqual({
      kind: 'offline',
      since: NOW - MINUTE,
    });
  });

  it('takes the newest word over the circles a person is in', () => {
    const states = {
      'a:u': stateOf({ circleId: 'a', ts: NOW - 5 * MINUTE, why: 'saver' }),
      'b:u': stateOf({ circleId: 'b', ts: NOW - MINUTE, why: 'nofix' }),
      'b:v': stateOf({ circleId: 'b', userId: 'v', ts: NOW, why: 'permission' }),
    };
    expect(newestState(states, 'u')?.why).toBe('nofix');
    expect(newestState(states, 'nobody')).toBeUndefined();
  });
});

describe('the time "since" in Turkish follows how it is read aloud', () => {
  const at = (hours: number, minutes: number) => new Date(2026, 9, 22, hours, minutes).getTime();

  it.each([
    [14, 20, "14:20'den"],
    [14, 30, "14:30'dan"],
    [14, 40, "14:40'tan"],
    [14, 50, "14:50'den"],
    [14, 10, "14:10'dan"],
    [15, 3, "15:03'ten"],
    [15, 5, "15:05'ten"],
    [15, 6, "15:06'dan"],
    [15, 7, "15:07'den"],
    [15, 8, "15:08'den"],
    [15, 9, "15:09'dan"],
    [15, 1, "15:01'den"],
    [15, 2, "15:02'den"],
    [15, 4, "15:04'ten"],
    // A full hour is read as the hour.
    [9, 0, "09:00'dan"],
    [10, 0, "10:00'dan"],
    [13, 0, "13:00'ten"],
    [20, 0, "20:00'den"],
    [23, 0, "23:00'ten"],
    [0, 0, "00:00'dan"],
  ])('%i:%i → %s', (hours, minutes, expected) => {
    expect(sinceTime(at(hours, minutes), 'tr')).toBe(expected);
  });

  it('is just the time of day in other languages', () => {
    expect(sinceTime(at(14, 20), 'en')).toMatch(/2:20/);
  });
});

describe('a reason from one phone to another', () => {
  let alice: Person;
  let bob: Person;
  let circle: Circle;

  beforeEach(() => {
    alice = somebody();
    bob = somebody();
    circle = circleOf([alice, bob]);
    exchangeKeys(circle, [alice, bob]);
    useLocations.setState({}, true);
    useStates.setState({}, true);
  });

  const key = () => `${circle.id}:${bob.userId}`;

  function receiverOf(store = alice.store, now = () => NOW) {
    return createReceiver({
      keys: () => alice.keys,
      circles: () => [circle],
      store: () => store,
      now,
    });
  }

  /** What bob's phone sends: a `state` message sealed for the circle. */
  function stateFromBob(payload: StatePayload) {
    return encryptMessage({
      state: { senderKey: bob.keys.ownKey(circle), nextSeq: bob.keys.reserveSeq(circle) },
      sender: bob.device,
      payload,
    }).envelope;
  }

  const locationFromBob = (ts: number) =>
    nth(
      buildEnvelopes({
        fix: { ...GALATA, ts },
        battery: { level: 60, charging: false },
        circles: [circle],
        settings: DEFAULT_SHARING,
        keys: bob.keys,
        device: bob.device,
        now: ts,
      }),
    );

  it.each(STATE_WHY)('keeps a %s state for the person, with no position', (why) => {
    const receiver = receiverOf();
    expect(
      receiver.receive(
        stateFromBob({ kind: 'state', why, since: NOW - 5 * MINUTE, ts: NOW - MINUTE }),
        'state',
      ),
    ).toBe('shown');
    expect(useStates.getState()[key()]).toMatchObject({
      why,
      since: NOW - 5 * MINUTE,
      ts: NOW - MINUTE,
      receivedAt: NOW,
    });
    // It moved nobody on the map: a reason is not a location.
    expect(useLocations.getState()).toEqual({});
  });

  it('shows the label for each reason next to an old location, and drops it with a fresh one', () => {
    const receiver = receiverOf();
    receiver.receive(locationFromBob(NOW - 40 * MINUTE), 'loc');
    const shown = () => {
      const loc = useLocations.getState()[key()]?.loc;
      if (loc === undefined) throw new Error('no location');
      return whyShown({ loc, state: newestState(useStates.getState(), bob.userId), now: NOW });
    };
    // Silence first: nothing said, nothing heard for 40 minutes.
    expect(shown()?.kind).toBe('offline');
    for (const why of ['saver', 'permission', 'nofix'] as const) {
      receiver.receive(
        stateFromBob({ kind: 'state', why, since: NOW - 30 * MINUTE, ts: NOW - MINUTE }),
        'state',
      );
      expect(shown()).toEqual({ kind: why, since: NOW - 30 * MINUTE });
    }
    // Their phone is back: a fresh location, and the label goes with it (the "none" may be late).
    receiver.receive(locationFromBob(NOW - 5_000), 'loc');
    expect(shown()).toBeNull();
  });

  it('infers "offline" for a person never heard from after the location, with its time', () => {
    const receiver = receiverOf();
    const sentAt = NOW - 47 * MINUTE;
    receiver.receive(locationFromBob(sentAt), 'loc');
    const loc = useLocations.getState()[key()]?.loc;
    expect(loc).toBeDefined();
    expect(whyShown({ loc: { ts: sentAt }, state: undefined, now: NOW })).toEqual({
      kind: 'offline',
      since: sentAt,
    });
  });

  it('ignores a reason older than the one held (it arrived late), and one from the future', () => {
    const receiver = receiverOf();
    const newer = stateFromBob({
      kind: 'state',
      why: 'nofix',
      since: NOW - MINUTE,
      ts: NOW - MINUTE,
    });
    const older = stateFromBob({
      kind: 'state',
      why: 'saver',
      since: NOW - 9 * MINUTE,
      ts: NOW - 8 * MINUTE,
    });
    expect(receiver.receive(newer, 'state')).toBe('shown');
    expect(receiver.receive(older, 'state')).toBe('ignored');
    expect(useStates.getState()[key()]?.why).toBe('nofix');
    // A clock ahead of this phone's would keep a reason alive for ever: it counts as now.
    const ahead = stateFromBob({
      kind: 'state',
      why: 'saver',
      since: NOW + 5 * 3_600_000,
      ts: NOW + 5 * 3_600_000,
    });
    receiver.receive(ahead, 'state');
    expect(useStates.getState()[key()]).toMatchObject({ why: 'saver', ts: NOW, since: NOW });
  });

  it('keeps the clear as the newest word, so a late "saver" cannot bring the label back', () => {
    const receiver = receiverOf();
    const saver = stateFromBob({
      kind: 'state',
      why: 'saver',
      since: NOW - 9 * MINUTE,
      ts: NOW - 8 * MINUTE,
    });
    const none = stateFromBob({
      kind: 'state',
      why: 'none',
      since: NOW - 2 * MINUTE,
      ts: NOW - 2 * MINUTE,
    });
    receiver.receive(none, 'state');
    expect(receiver.receive(saver, 'state')).toBe('ignored');
    expect(useStates.getState()[key()]?.why).toBe('none');
  });

  it('is kept across a restart, and goes with the location when the person stops sharing', () => {
    const first = receiverOf();
    first.receive(locationFromBob(NOW - 40 * MINUTE), 'loc');
    first.receive(
      stateFromBob({ kind: 'state', why: 'permission', since: NOW - MINUTE, ts: NOW - MINUTE }),
      'state',
    );
    useStates.setState({}, true);
    useLocations.setState({}, true);
    const second = receiverOf();
    second.restore();
    expect(useStates.getState()[key()]?.why).toBe('permission');
    expect(useLocations.getState()[key()]).toBeDefined();
    // They took their location back (ghost "hide", sharing off): the reason is not theirs to keep.
    second.gone(circle.id, bob.userId);
    expect(useStates.getState()).toEqual({});
    expect(useLocations.getState()).toEqual({});
    // And what is on disk is gone too.
    useStates.setState({}, true);
    receiverOf().restore();
    expect(useStates.getState()).toEqual({});
  });

  it('drops the reasons of people who left the circle', () => {
    const receiver = createReceiver({
      keys: () => alice.keys,
      circles: () => [circle],
      store: () => alice.store,
      now: () => NOW,
    });
    receiver.receive(locationFromBob(NOW - MINUTE), 'loc');
    receiver.receive(stateFromBob({ kind: 'state', why: 'saver', since: NOW, ts: NOW }), 'state');
    expect(Object.keys(useStates.getState())).toHaveLength(1);
    const left: Circle = {
      ...circle,
      members: circle.members.filter((member) => member.userId !== bob.userId),
    };
    const afterwards = createReceiver({
      keys: () => alice.keys,
      circles: () => [left],
      store: () => alice.store,
      now: () => NOW,
    });
    afterwards.prune();
    expect(useStates.getState()).toEqual({});
  });

  it('sign-out takes everything', () => {
    const receiver = receiverOf(memoryStore());
    receiver.receive(stateFromBob({ kind: 'state', why: 'saver', since: NOW, ts: NOW }), 'state');
    receiver.reset();
    expect(useStates.getState()).toEqual({});
  });

  it('does not touch the location that was shown', () => {
    const receiver = receiverOf();
    receiver.receive(locationFromBob(NOW - 40 * MINUTE), 'loc');
    const before = useLocations.getState()[key()];
    receiver.receive(stateFromBob({ kind: 'state', why: 'nofix', since: NOW, ts: NOW }), 'state');
    expect(useLocations.getState()[key()]).toEqual(before);
    expect(locPayload(GALATA, { level: 60, charging: false }).lat).toBe(before?.loc.lat);
  });
});
