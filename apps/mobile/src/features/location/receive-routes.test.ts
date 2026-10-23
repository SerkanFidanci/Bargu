import { encryptMessage } from '@bargu/crypto';
import type { Circle, MessageEnvelope, Payload } from '@bargu/schemas';

import { createReceiver, kindFitsRoute, type Route, useLocations } from './receive';
import { circleOf, exchangeKeys, GALATA, memoryStore, type Person, somebody } from './test-support';
import { useStates } from './why';

/**
 * The relay forwards any message through the poke, "Güvendeyim" and place routes (it cannot read
 * them), and those routes skip the paused-circle check and the limits of the location route (QA-32
 * F-1). The phone binds the kind to the route the message came by (docs/ADR/0029 §8).
 */

const NOW = 1_800_000_000_000;
const SAFE_ID = 'AAAAAAAAAAAAAAAAAAAAAA';

const payloads = {
  loc: { kind: 'loc', lat: GALATA.lat, lng: GALATA.lng, acc: 8, bat: 50, chg: false, ts: NOW },
  bump: { kind: 'bump', ts: NOW },
  poke: { kind: 'poke', to: '0190f7a4-1111-7111-8111-0000000000b0', style: 'kiss', ts: NOW },
  safe: {
    kind: 'safe',
    id: SAFE_ID,
    lat: GALATA.lat,
    lng: GALATA.lng,
    acc: 8,
    bat: 50,
    ts: NOW,
  },
  place: { kind: 'place_enter', placeId: '0190f7a4-2222-7222-8222-000000000001', ts: NOW },
  late: { kind: 'late', meetAt: NOW + 3_600_000, minutes: 10, ts: NOW },
  arrived: { kind: 'arrived', meetAt: NOW, ts: NOW },
  status: { kind: 'status', emoji: '☕', text: 'kahve', expiresAt: NOW + 1000, ts: NOW },
  profile: { kind: 'profile', photo: null, ts: NOW },
  look: { kind: 'look', ring: null, frame: null, pass: null, ts: NOW },
  stop: { kind: 'share_stop', ts: NOW },
  state: { kind: 'state', why: 'saver', since: NOW - 60_000, ts: NOW },
} as const satisfies Record<string, Payload>;

interface World {
  ayse: Person;
  bora: Person;
  circle: Circle;
  heard: string[];
  receiver: ReturnType<typeof createReceiver>;
  send: (payload: Payload) => MessageEnvelope;
}

function world(overrides: Partial<Circle> = {}, exchange = true): World {
  const [ayse, bora] = [somebody(), somebody()];
  const circle = circleOf([ayse, bora], overrides);
  if (exchange) exchangeKeys(circle, [ayse, bora]);
  else ayse.keys.observe(circle);
  const heard: string[] = [];
  const receiver = createReceiver({
    keys: () => bora.keys,
    circles: () => [circle],
    store: () => memoryStore(),
    now: () => NOW,
    onBump: () => heard.push('bump'),
    onPoke: () => heard.push('poke'),
    onSafe: () => heard.push('safe'),
    onStatus: () => heard.push('status'),
    onProfile: () => heard.push('profile'),
    onLook: () => heard.push('look'),
    onPlace: () => heard.push('place'),
    onLate: () => heard.push('late'),
    onArrived: () => heard.push('arrived'),
  });
  return {
    ayse,
    bora,
    circle,
    heard,
    receiver,
    send: (payload) =>
      encryptMessage({
        state: { senderKey: ayse.keys.ownKey(circle), nextSeq: ayse.keys.reserveSeq(circle) },
        sender: ayse.device,
        payload,
      }).envelope,
  };
}

beforeEach(() => {
  useLocations.setState({}, true);
  useStates.setState({}, true);
});

describe('a message counts as the kind its route is for (QA-32 F-1, F-1.2)', () => {
  it('shows each kind by its own route', () => {
    const w = world();
    const cases: [Payload, Route, string][] = [
      [payloads.bump, 'bump', 'bump'],
      [payloads.poke, 'bump', 'poke'],
      [payloads.safe, 'safe', 'safe'],
      [payloads.place, 'place', 'place'],
      [payloads.late, 'place', 'late'],
      [payloads.arrived, 'place', 'arrived'],
      [payloads.status, 'status', 'status'],
      [payloads.profile, 'profile', 'profile'],
      [payloads.look, 'look', 'look'],
    ];
    for (const [payload, route, heard] of cases) {
      expect(w.receiver.receive(w.send(payload), route)).not.toBe('ignored');
      expect(w.heard.at(-1)).toBe(heard);
    }
    expect(w.receiver.receive(w.send(payloads.loc), 'loc')).toBe('shown');
    expect(Object.keys(useLocations.getState())).toHaveLength(1);
    expect(w.receiver.receive(w.send(payloads.stop), 'loc')).toBe('removed');
  });

  it('drops a "Güvendeyim" that came by any other route, or by none: never an unmutable one', () => {
    for (const route of ['bump', 'loc', 'place', 'status', 'profile', 'look', undefined] as const) {
      const w = world();
      expect(w.receiver.receive(w.send(payloads.safe), route)).toBe('ignored');
      expect(w.heard).toEqual([]);
    }
  });

  it('drops what is not a "Güvendeyim" on the "Güvendeyim" route', () => {
    for (const payload of [
      payloads.bump,
      payloads.status,
      payloads.place,
      payloads.late,
      payloads.profile,
      payloads.stop,
    ]) {
      const w = world();
      expect(w.receiver.receive(w.send(payload), 'safe')).toBe('ignored');
      expect(w.heard).toEqual([]);
    }
  });

  it('does not show a location sent through the "Güvendeyim" route into a paused circle', () => {
    const w = world({ paused: true });
    // The server forwards it (it cannot read it, and "Güvendeyim" skips the paused check)...
    expect(w.receiver.receive(w.send(payloads.loc), 'safe')).toBe('ignored');
    // ...the poke route is no way in either...
    expect(w.receiver.receive(w.send(payloads.loc), 'bump')).toBe('ignored');
    // ...and nothing of it is on the map.
    expect(useLocations.getState()).toEqual({});
    expect(w.heard).toEqual([]);
  });

  it('keeps the route of a message that waited for its sender key', () => {
    const waitedForKey = world({}, false);
    const { bora, ayse, circle, receiver, heard } = waitedForKey;
    bora.keys.observe(circle);
    const safe = waitedForKey.send(payloads.safe);
    // No key yet: it waits (the newest per sender), with the route it came by.
    expect(receiver.receive(safe, 'safe')).toBe('waiting');
    // The key arrives; the "Güvendeyim" is then handled as one.
    const distributions = ayse.keys.pendingDistributions(circle);
    bora.keys.accept(circle, distributions);
    receiver.retryWaiting();
    expect(heard).toEqual(['safe']);

    // A location that came by the "Güvendeyim" route and waited is dropped when it is retried.
    const other = world({ paused: true }, false);
    other.bora.keys.observe(other.circle);
    expect(other.receiver.receive(other.send(payloads.loc), 'safe')).toBe('waiting');
    other.bora.keys.accept(other.circle, other.ayse.keys.pendingDistributions(other.circle));
    other.receiver.retryWaiting();
    expect(useLocations.getState()).toEqual({});
  });

  it('shows a reason ("Neden eski?") only by the state route, which shows nothing else', () => {
    const w = world();
    expect(w.receiver.receive(w.send(payloads.state), 'state')).toBe('shown');
    expect(Object.values(useStates.getState())).toHaveLength(1);
    // By any other route, or none, it is dropped: those skip the state route's paused-circle check
    // and its limit, and it must not be a way round them.
    for (const route of [
      'loc',
      'bump',
      'safe',
      'place',
      'status',
      'profile',
      'look',
      undefined,
    ] as const) {
      useStates.setState({}, true);
      const other = world();
      expect(other.receiver.receive(other.send(payloads.state), route)).toBe('ignored');
      expect(useStates.getState()).toEqual({});
    }
    // And nothing else counts on the state route.
    for (const payload of [
      payloads.loc,
      payloads.stop,
      payloads.bump,
      payloads.safe,
      payloads.place,
      payloads.late,
      payloads.arrived,
      payloads.status,
      payloads.profile,
      payloads.look,
    ]) {
      const other = world();
      expect(other.receiver.receive(other.send(payload), 'state')).toBe('ignored');
      expect(other.heard).toEqual([]);
    }
    expect(useLocations.getState()).toEqual({});
    expect(useStates.getState()).toEqual({});
  });

  it('does not take a reason sent through the location or poke route into a paused circle', () => {
    const w = world({ paused: true });
    expect(w.receiver.receive(w.send(payloads.state), 'loc')).toBe('ignored');
    expect(w.receiver.receive(w.send(payloads.state), 'bump')).toBe('ignored');
    expect(useStates.getState()).toEqual({});
  });

  it('keeps the route of a reason that waited for its key, beside the location that waits too', () => {
    const waited = world({}, false);
    const { bora, ayse, circle, receiver } = waited;
    bora.keys.observe(circle);
    expect(receiver.receive(waited.send(payloads.loc), 'loc')).toBe('waiting');
    // The reason waits too, in a place of its own: it does not push the location out.
    expect(receiver.receive(waited.send(payloads.state), 'state')).toBe('waiting');
    bora.keys.accept(circle, ayse.keys.pendingDistributions(circle));
    receiver.retryWaiting();
    expect(Object.keys(useLocations.getState())).toHaveLength(1);
    expect(Object.keys(useStates.getState())).toHaveLength(1);

    // One that came by the wrong route and waited is dropped when it is tried again.
    const other = world({}, false);
    other.bora.keys.observe(other.circle);
    expect(other.receiver.receive(other.send(payloads.state), 'bump')).toBe('waiting');
    other.bora.keys.accept(other.circle, other.ayse.keys.pendingDistributions(other.circle));
    other.receiver.retryWaiting();
    expect(Object.keys(useStates.getState())).toHaveLength(1);
  });

  it('is a plain table: only a safe kind fits the safe route, only on it, and an unknown route fits all else', () => {
    expect(kindFitsRoute('safe', 'safe')).toBe(true);
    expect(kindFitsRoute('safe', 'bump')).toBe(false);
    expect(kindFitsRoute('safe', undefined)).toBe(false);
    expect(kindFitsRoute('loc', 'safe')).toBe(false);
    expect(kindFitsRoute('loc', 'bump')).toBe(false);
    expect(kindFitsRoute('loc', 'loc')).toBe(true);
    // Callers that name no route (older tests, a batch of unknown origin) keep working for the rest.
    expect(kindFitsRoute('loc', undefined)).toBe(true);
    expect(kindFitsRoute('bump', undefined)).toBe(true);
    // A reason is its own kind on its own route; no route at all never shows one.
    expect(kindFitsRoute('state', 'state')).toBe(true);
    expect(kindFitsRoute('state', 'loc')).toBe(false);
    expect(kindFitsRoute('state', undefined)).toBe(false);
    expect(kindFitsRoute('loc', 'state')).toBe(false);
  });
});
