import { encryptMessage, exportDeviceKeyBundle } from '@bargu/crypto';
import type { Circle, MessageEnvelope, Payload } from '@bargu/schemas';
import { QueryClient } from '@tanstack/react-query';

import { useAvatarPhotos } from '@/ui/avatar-photos';

import { circlesKey } from '../circles/circle-cache';
import { createCircleSync } from '../circles/circle-sync';
import type { circlesApi } from '../circles/circles-api';
import { useLooks } from '../cosmetics/look-session';
import { useHistoryPings } from '../history/history-api';
import { forgetCheckedBundles, verifiedBundle } from '../keys/bundle-cache';
import { updateMutes } from '../notifications/mute-session';
import { loadMutes, NO_MUTES, withPersonMuted } from '../notifications/mutes';
import { useArrived, useLates } from '../plan/meeting';
import { usePokes } from '../social/poke';
import { receiveSafe } from '../social/safe';
import { useSafeSpot } from '../social/safe-spot';
import { receivedStatus, useStatuses } from '../social/status';
import { forgetDeparted } from './forget-person';
import { createReceiver, useLocations } from './receive';
import { card, circleOf, exchangeKeys, type Person, somebody } from './test-support';
import { useStates } from './why';

// The phone the module singletons act as (its keys, its vault, its account), switched by a test.
let mockPhone: Person;
jest.mock('../auth/auth-store', () => ({
  api: { authed: () => Promise.reject(new Error('offline')) },
  useAuth: { getState: () => ({ userId: mockPhone.userId, device: mockPhone.device }) },
  onSignedOut: jest.fn(),
}));
jest.mock('../live/live-session', () => ({
  keys: () => mockPhone.keys,
  liveRequest: () => null,
}));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => true, vault: () => mockPhone.store }));
jest.mock('../notifications/extension-share', () => ({
  shareMutesWithExtension: () => Promise.resolve(),
}));

const SAFE_IDS = ['aaaaaaaaaaaaaaaaaaaaaA', 'bbbbbbbbbbbbbbbbbbbbbA'] as const;

/** Everything a phone can hold about one person, as `holds` names it. */
const EVERYTHING = [
  'arrived',
  'checked bundle',
  'history key',
  'history ping',
  'key sent to them',
  'known viewer',
  'late',
  'location',
  'look',
  'mute',
  'photo',
  'poke',
  'reason',
  'replay window',
  'safe memory',
  'safe place',
  'sender key',
  'status',
];

const newClient = () => new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });

function world() {
  const me = somebody();
  mockPhone = me;
  const bob = somebody();
  const dana = somebody();
  // Bob shares two circles with this phone, Dana one (the control: nothing of hers may go).
  const home = circleOf([me, bob], { name: 'Ev' });
  const club = circleOf([me, bob], { name: 'Kulüp' });
  const crew = circleOf([me, dana], { name: 'Ekip' });
  exchangeKeys(home, [me, bob]);
  exchangeKeys(club, [me, bob]);
  exchangeKeys(crew, [me, dana]);

  const queryClient = newClient();
  const api = {
    list: jest.fn(() => Promise.resolve([home, club, crew])),
    get: jest.fn<Promise<Circle>, [string]>(() => Promise.reject(new Error('not expected'))),
    uploadKeys: jest.fn(() => Promise.resolve()),
    keys: jest.fn(() => Promise.resolve([])),
    rekey: jest.fn(() => Promise.reject(new Error('not expected'))),
  };
  const receiver = createReceiver({
    keys: () => me.keys,
    circles: () => queryClient.getQueryData<Circle[]>(circlesKey) ?? [],
    store: () => me.store,
  });
  const connect = (client: QueryClient) =>
    createCircleSync({
      queryClient: client,
      api: api as unknown as typeof circlesApi,
      keys: () => me.keys,
      departed: forgetDeparted({ receiver, keys: () => me.keys, store: () => me.store }),
    });

  // Nothing of an earlier test is left in the module singletons.
  forgetCheckedBundles();
  useLocations.setState({}, true);
  useStates.setState({}, true);
  useStatuses.setState({}, true);
  useAvatarPhotos.setState({}, true);
  useLooks.setState({}, true);
  usePokes.setState({}, true);
  useLates.setState({}, true);
  useArrived.setState({}, true);
  useHistoryPings.setState({}, true);
  useSafeSpot.setState({ spot: null, request: 0 });
  updateMutes(() => NO_MUTES);

  /** The checked bundle of each person, as the cache handed it out when they were seeded. */
  const bundles = new Map<string, ReturnType<typeof verifiedBundle>>();
  return {
    me,
    bob,
    dana,
    home,
    club,
    crew,
    queryClient,
    api,
    receiver,
    connect,
    sync: connect(queryClient),
    bundles,
  };
}
type World = ReturnType<typeof world>;

const LOCATION = { kind: 'loc', lat: 41, lng: 29, acc: 10, bat: 80, chg: false } as const;

function envelopeFrom(
  person: Person,
  circle: Circle,
  payload: Payload,
  epoch = circle.epoch,
): MessageEnvelope {
  const circleEpoch = { id: circle.id, epoch };
  return encryptMessage({
    state: {
      senderKey: person.keys.ownKey(circleEpoch),
      nextSeq: person.keys.reserveSeq(circleEpoch),
    },
    sender: person.device,
    payload,
  }).envelope;
}

/** Keeps `value` under `key` in a JSON record in the vault (what the owning modules would keep). */
function keepIn(world: World, key: string, field: string, value: unknown): void {
  const held = JSON.parse(world.me.store.get(key) ?? '{}') as Record<string, unknown>;
  world.me.store.set(key, JSON.stringify({ ...held, [field]: value }));
}

/** Gives this phone something of every kind about `person`, who is in `circle`. */
function seed(w: World, person: Person, circle: Circle, index: 0 | 1): void {
  const { me, receiver } = w;
  const id = person.userId;
  const ts = Date.now();
  // Messages as they arrive: a location, and why a location is old (replay window and all).
  receiver.receive(envelopeFrom(person, circle, { ...LOCATION, ts }), 'loc');
  receiver.receive(
    envelopeFrom(person, circle, { kind: 'state', why: 'saver', since: ts, ts }),
    'state',
  );
  receivedStatus(circle.id, id, {
    kind: 'status',
    emoji: '🚲',
    text: 'Yoldayım',
    expiresAt: ts + 3_600_000,
    ts,
  });
  // A photo and a look, as their modules keep them.
  keepIn(w, 'photo:keys:v1', id, { id: 'p', key: 'k', deviceId: person.device.deviceId });
  me.store.set(`photo:img:${id}`, JSON.stringify({ id: 'p', image: 'AAAA' }));
  useAvatarPhotos.setState({ [id]: 'data:image/jpeg;base64,AAAA' });
  keepIn(w, 'look:others:v1', id, { ring: null, frame: null, pass: null, ts });
  useLooks.setState({ ...useLooks.getState(), [id]: { until: ts + 1e6, ts } });
  // A "Güvendeyim": its place, the times it was shown and the ids shown.
  receiveSafe({
    store: me.store,
    circles: [circle],
    circleId: circle.id,
    userId: id,
    safe: { kind: 'safe', id: SAFE_IDS[index], lat: 41, lng: 29, acc: 20, bat: 50, ts },
    now: ts,
  });
  // What the phone remembers about them, and what it was told to keep quiet.
  updateMutes((current) => withPersonMuted(current, id, { pokes: true }));
  usePokes.setState({ ...usePokes.getState(), [id]: ts });
  const entry = `${circle.id}:${id}`;
  useLates.setState({ ...useLates.getState(), [entry]: { meetAt: ts, minutes: 5, ts } });
  useArrived.setState({ ...useArrived.getState(), [entry]: { meetAt: ts, ts } });
  useHistoryPings.setState({ ...useHistoryPings.getState(), [entry]: 1 });
  keepIn(w, 'location:viewers:v1', circle.id, [id]);
  keepIn(w, 'history:viewers:v1', circle.id, [id]);
  w.bundles.set(id, verifiedBundle(exportDeviceKeyBundle(person.device)));
}

/** What this phone still holds about `person`, by kind (sorted). */
function holds(w: World, person: Person): string[] {
  const { me } = w;
  const id = person.userId;
  const device = person.device.deviceId;
  const vaultHas = (key: string, needle = id) => (me.store.get(key) ?? '').includes(needle);
  const keysOf = (prefix: string) =>
    me.store.keys().filter((key) => key.startsWith(prefix) && key.endsWith(`:${device}`));
  const keyedBy = (state: Record<string, unknown>) =>
    Object.keys(state).some((key) => key.endsWith(`:${id}`));
  // The cache hands out the very same object for a bundle it still has (and a new one if not).
  const bundleCached = () =>
    verifiedBundle({ ...exportDeviceKeyBundle(person.device) }) === w.bundles.get(id);
  const found: Record<string, boolean> = {
    location:
      Object.values(useLocations.getState()).some((entry) => entry.userId === id) ||
      vaultHas('locations:v1'),
    reason:
      Object.values(useStates.getState()).some((entry) => entry.userId === id) ||
      vaultHas('states:v1'),
    status:
      Object.values(useStatuses.getState()).some((entry) => entry.userId === id) ||
      vaultHas('statuses:v1'),
    photo:
      id in useAvatarPhotos.getState() ||
      vaultHas('photo:keys:v1') ||
      me.store.get(`photo:img:${id}`) !== undefined,
    look: id in useLooks.getState() || vaultHas('look:others:v1'),
    'safe place': vaultHas('safe:spots:v1') || useSafeSpot.getState().spot?.userId === id,
    'safe memory': vaultHas('safe:rate:v1') || vaultHas('safe:seen:v1'),
    'sender key': keysOf('recv:').length > 0,
    'history key': keysOf('hist:').length > 0,
    'key sent to them': me.store
      .keys()
      .some((key) => key.startsWith('own:') && vaultHas(key, device)),
    'replay window': vaultHas('replay:v1', device),
    'checked bundle': bundleCached(),
    'known viewer': vaultHas('location:viewers:v1') || vaultHas('history:viewers:v1'),
    mute: loadMutes(me.store).people[id] !== undefined,
    poke: id in usePokes.getState(),
    late: keyedBy(useLates.getState()),
    arrived: keyedBy(useArrived.getState()),
    'history ping': keyedBy(useHistoryPings.getState()),
  };
  return Object.entries(found)
    .filter(([, held]) => held)
    .map(([kind]) => kind)
    .sort();
}

describe('a person this phone shares no circle with any more is forgotten', () => {
  /** The ways the last shared circle (`home`) can go. */
  const ways: [string, (w: World) => Promise<void>][] = [
    [
      'this phone leaves it or is removed from it (circle.gone)',
      async (w) => {
        await w.sync.apply([{ type: 'circle.gone', circleId: w.home.id }]);
      },
    ],
    [
      'the person leaves it',
      async (w) => {
        w.api.get.mockResolvedValue({ ...w.home, members: [card(w.me)] });
        await w.sync.apply([{ type: 'circle.changed', circleId: w.home.id, epoch: 2 }]);
      },
    ],
    [
      'this phone removes them (the circle comes back from the action)',
      async (w) => {
        await w.sync.adopt({ ...w.home, members: [card(w.me)] });
      },
    ],
    [
      'the circle ends (circles.reload)',
      async (w) => {
        w.api.list.mockResolvedValueOnce([w.crew]);
        await w.sync.apply([{ type: 'circles.reload' }]);
      },
    ],
    [
      'an event circle is over on this phone (drop)',
      (w) => {
        w.sync.drop(w.home.id);
        return Promise.resolve();
      },
    ],
    [
      'they left while the app was closed',
      async (w) => {
        w.api.list.mockResolvedValueOnce([w.crew]);
        await w.connect(newClient()).reload();
      },
    ],
  ];

  it.each(ways)(
    'keeps all of it while one shared circle remains; then, when %s, deletes all of it',
    async (_name, lastCircleGoes) => {
      const w = world();
      await w.sync.reload();
      seed(w, w.bob, w.home, 0);
      seed(w, w.dana, w.crew, 1);
      expect(holds(w, w.bob)).toEqual(EVERYTHING);
      expect(holds(w, w.dana)).toEqual(EVERYTHING);

      // One of the two circles goes: Bob is still shared with, so nothing of him is touched.
      await w.sync.apply([{ type: 'circle.gone', circleId: w.club.id }]);
      expect(holds(w, w.bob)).toEqual(EVERYTHING);
      expect(holds(w, w.dana)).toEqual(EVERYTHING);

      // The last one goes: he is gone from this phone, and Dana (whose circle stays) is untouched.
      await lastCircleGoes(w);
      expect(holds(w, w.bob)).toEqual([]);
      expect(holds(w, w.dana)).toEqual(EVERYTHING);
      expect(w.me.keys.knownPeople()).toEqual({ [w.dana.userId]: [w.dana.device.deviceId] });
    },
  );

  it('keeps the trust record: the same person met again with another key is not a first use', async () => {
    const w = world();
    await w.sync.reload();
    seed(w, w.bob, w.home, 0);
    const known = w.me.keys.identity(w.bob.userId);
    expect(known).not.toBeNull();

    await w.sync.apply([{ type: 'circle.gone', circleId: w.club.id }]);
    await w.sync.apply([{ type: 'circle.gone', circleId: w.home.id }]);
    expect(holds(w, w.bob)).toEqual([]);

    // What stays is a public identity key and whether it was compared in person: no name, no content.
    expect(w.me.keys.identity(w.bob.userId)).toEqual(known);
    expect(Object.keys(known ?? {}).sort()).toEqual(['changedTo', 'key', 'verified']);
    // Met again with a different key: noticed, and held until the user accepts it.
    const swapped = { ...somebody(), userId: w.bob.userId };
    const back: Circle = { ...w.home, members: [card(w.me), card(swapped)] };
    expect(w.me.keys.observe(back)).toEqual([w.bob.userId]);
    expect(w.me.keys.trust(w.bob.userId)).toBe('changed');
  });

  it('deletes nothing before the full circle list has been loaded', async () => {
    const w = world();
    await w.sync.reload();
    seed(w, w.bob, w.home, 0);
    seed(w, w.dana, w.crew, 1);
    // The phone starts again: the cache is empty and circles come in one by one, here two of them
    // without Bob and none with Dana. That is a partial list, not people who left.
    const again = w.connect(newClient());
    await again.adopt({ ...w.home, members: [card(w.me)] });
    await again.adopt({ ...w.club, members: [card(w.me)] });
    again.drop(w.club.id);
    expect(holds(w, w.bob)).toEqual(EVERYTHING);
    expect(holds(w, w.dana)).toEqual(EVERYTHING);
  });

  describe('a message that waited for their key', () => {
    /** Bob's location in an epoch whose key has not come; then the key arrives. */
    async function waitingThenKey(forget: boolean) {
      const w = world();
      await w.sync.reload();
      const later = { ...w.home, epoch: w.home.epoch + 1 };
      const waiting = envelopeFrom(w.bob, w.home, { ...LOCATION, ts: Date.now() }, later.epoch);
      expect(w.receiver.receive(waiting)).toBe('waiting');
      if (forget) w.receiver.forgetPerson(w.bob.userId, new Set([w.bob.device.deviceId]));
      w.bob.keys.observe(later);
      w.me.keys.observe(later);
      w.me.keys.accept(later, w.bob.keys.pendingDistributions(later));
      w.queryClient.setQueryData<Circle[]>(circlesKey, [later]);
      w.receiver.retryWaiting();
      return Object.values(useLocations.getState()).filter(
        (entry) => entry.userId === w.bob.userId,
      );
    }

    it('is shown when the key comes, unless the person was forgotten meanwhile', async () => {
      expect(await waitingThenKey(false)).toHaveLength(1);
      expect(await waitingThenKey(true)).toEqual([]);
    });
  });
});
