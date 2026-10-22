import {
  createSenderKeyDistribution,
  type DeviceKeys,
  exportDeviceKeyBundle,
  generateDeviceKeys,
  generateSenderKey,
  randomUuid,
  REKEY_INTERVAL_MS,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import type { Circle, MemberCard, SenderKeyDistribution } from '@bargu/schemas';
import { QueryClient } from '@tanstack/react-query';

import { ApiError } from '../auth/api-client';
import { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';
import { circlesKey } from './circle-cache';
import { createCircleSync, type DepartedPerson, useCircleKeys } from './circle-sync';
import type { circlesApi } from './circles-api';
import type { Notice } from './notices';

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    get: (key) => data.get(key),
    set: (key, value) => {
      data.set(key, value);
    },
    delete: (key) => {
      data.delete(key);
    },
    keys: () => [...data.keys()],
    clear: () => {
      data.clear();
    },
  };
}

interface Person {
  userId: string;
  device: DeviceKeys;
}
const somebody = (): Person => ({ userId: randomUuid(), device: generateDeviceKeys(randomUuid()) });
const card = (person: Person): MemberCard => ({
  userId: person.userId,
  role: 'member',
  status: 'active',
  username: null,
  displayName: 'Test',
  avatar: null,
  device: { platform: 'android', bundle: exportDeviceKeyBundle(person.device) },
});

const NOW = 1_800_000_000_000;

function setup() {
  const me = somebody();
  const bob = somebody();
  const circle: Circle = {
    id: randomUuid(),
    kind: 'pair',
    name: null,
    epoch: 2,
    epochStartedAt: NOW - 1000,
    myRole: 'owner',
    myStatus: 'active',
    members: [card(me), card(bob)],
  };
  const api = {
    list: jest.fn(() => Promise.resolve([circle])),
    get: jest.fn<Promise<Circle>, [string]>(() => Promise.resolve(circle)),
    uploadKeys: jest.fn<Promise<void>, [string, number, SenderKeyDistribution[]]>(() =>
      Promise.resolve(),
    ),
    keys: jest.fn(() => Promise.resolve([] as SenderKeyDistribution[])),
    rekey: jest.fn(() => Promise.resolve({ ...circle, epoch: circle.epoch + 1 })),
  };
  const store = new KeyStore(memoryStore(), me);
  const notify = jest.fn<undefined, [Notice[]]>();
  const firstLoad = jest.fn<undefined, [Circle[]]>();
  const gone = jest.fn<undefined, [(circleId: string) => boolean]>();
  const departed = jest.fn<undefined, [readonly DepartedPerson[]]>();
  /** A phone that starts again with the same vault: nothing in memory, the same account. */
  const restart = () => {
    const fresh = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
    return {
      queryClient: fresh,
      sync: createCircleSync({
        queryClient: fresh,
        api: api as unknown as typeof circlesApi,
        keys: () => store,
        notify,
        firstLoad,
        gone,
        departed,
        now: () => NOW,
      }),
    };
  };
  // No garbage-collection timers: they would outlive the test.
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const sync = createCircleSync({
    queryClient,
    api: api as unknown as typeof circlesApi,
    keys: () => store,
    notify,
    firstLoad,
    gone,
    departed,
    now: () => NOW,
  });
  /** Bob's sender key for the circle, wrapped for this phone. */
  const fromBob = (epoch = circle.epoch) =>
    createSenderKeyDistribution({
      senderKey: generateSenderKey({
        circleId: circle.id,
        epoch,
        senderDeviceId: bob.device.deviceId,
      }),
      sender: bob.device,
      recipient: verifyDeviceKeyBundle(exportDeviceKeyBundle(me.device)),
    });
  return {
    me,
    bob,
    circle,
    api,
    store,
    queryClient,
    sync,
    restart,
    fromBob,
    notify,
    firstLoad,
    gone,
    departed,
  };
}

describe('circle sync', () => {
  it('on a change: fetches the circle and hands our key to its members', async () => {
    const { bob, circle, api, queryClient, sync } = setup();
    await sync.apply([{ type: 'circle.changed', circleId: circle.id, epoch: circle.epoch }]);
    expect(api.get).toHaveBeenCalledWith(circle.id);
    expect(queryClient.getQueryData<Circle[]>(circlesKey)?.map((c) => c.id)).toEqual([circle.id]);
    const [, epoch, distributions] = api.uploadKeys.mock.calls[0] ?? [];
    expect(epoch).toBe(circle.epoch);
    expect(distributions?.map((d) => d.recipientDeviceId)).toEqual([bob.device.deviceId]);
    expect(useCircleKeys.getState()[circle.id]?.trust).toEqual({ [bob.userId]: 'unverified' });

    // Already sent for this epoch: a second event does not upload again.
    await sync.apply([{ type: 'circle.changed', circleId: circle.id, epoch: circle.epoch }]);
    expect(api.uploadKeys).toHaveBeenCalledTimes(1);
  });

  it('when keys arrive: opens the ones addressed to this phone and reports the circle ready', async () => {
    const { bob, circle, api, store, sync, fromBob } = setup();
    await sync.adopt(circle);
    api.keys.mockResolvedValueOnce([fromBob()]);
    await sync.apply([{ type: 'keys.available', circleId: circle.id, epoch: circle.epoch }]);
    expect(store.receivedKey(circle.id, circle.epoch, bob.device.deviceId)).not.toBeNull();
    expect(useCircleKeys.getState()[circle.id]?.ready).toBe(true);
  });

  it('after a key is accepted, hands ours over in every circle shared with them (2026-10-16)', async () => {
    const { me, bob, circle, api, store, queryClient, sync } = setup();
    const friends: Circle = { ...circle, id: randomUuid(), kind: 'friends', name: 'Ev' };
    const other: Circle = { ...circle, id: randomUuid(), members: [card(me), card(somebody())] };
    queryClient.setQueryData<Circle[]>(circlesKey, [circle, friends, other]);
    // Bob's phone was replaced: his new key is on hold everywhere.
    store.observe(circle);
    const bobNew = { ...bob, device: generateDeviceKeys(randomUuid()) };
    const fresh = (shared: Circle) => ({ ...shared, members: [card(me), card(bobNew)] });
    api.get.mockImplementation((circleId: string) =>
      Promise.resolve(fresh(circleId === friends.id ? friends : circle)),
    );
    store.observe(fresh(circle));
    expect(store.trust(bob.userId)).toBe('changed');

    store.acknowledgeChange(bob.userId);
    await sync.resyncMember(bob.userId);
    // Both circles with Bob are fetched again and get our key; the one without him is left alone.
    expect(api.get.mock.calls.map(([circleId]) => circleId).sort()).toEqual(
      [circle.id, friends.id].sort(),
    );
    const uploadedTo = api.uploadKeys.mock.calls.map(([circleId]) => circleId);
    expect(uploadedTo).toEqual(expect.arrayContaining([circle.id, friends.id]));
    expect(uploadedTo).not.toContain(other.id);
    for (const shared of [circle, friends]) {
      expect(useCircleKeys.getState()[shared.id]?.trust[bob.userId]).toBe('unverified');
    }
  });

  it('forgets a circle that is gone, with its keys', async () => {
    const { circle, store, queryClient, sync } = setup();
    await sync.adopt(circle);
    await sync.apply([{ type: 'circle.gone', circleId: circle.id }]);
    expect(queryClient.getQueryData<Circle[]>(circlesKey)).toEqual([]);
    expect(store.knownCircles()).toEqual([]);
    expect(useCircleKeys.getState()[circle.id]).toBeUndefined();
  });

  it('starts over when the epoch moved on meanwhile (someone joined or left)', async () => {
    const { circle, api, sync } = setup();
    api.uploadKeys.mockRejectedValueOnce(new ApiError(409, 'EPOCH_STALE'));
    api.get.mockResolvedValueOnce({ ...circle, epoch: circle.epoch + 1 });
    await sync.adopt(circle);
    expect(api.uploadKeys.mock.calls.map(([, epoch]) => epoch)).toEqual([
      circle.epoch,
      circle.epoch + 1,
    ]);
  });

  it('asks once for a new epoch when the current one is a day old', async () => {
    const { circle, api, sync } = setup();
    const old = { ...circle, epochStartedAt: NOW - REKEY_INTERVAL_MS - 1 };
    await sync.adopt(old);
    await sync.adopt(old);
    expect(api.rekey).toHaveBeenCalledTimes(1);
  });

  it('reports a failed sync so the stream can reload later', async () => {
    const { circle, api, sync } = setup();
    api.get.mockRejectedValueOnce(new TypeError('Network request failed'));
    await expect(
      sync.apply([{ type: 'circle.changed', circleId: circle.id, epoch: circle.epoch }]),
    ).rejects.toThrow();
  });

  it('tells a new phone about circles it is already in, before they reach the cache', async () => {
    const { circle, queryClient, sync, firstLoad } = setup();
    firstLoad.mockImplementation(() => {
      // Settings are made safe before anything can be sent to these circles.
      expect(queryClient.getQueryData(circlesKey)).toBeUndefined();
      return undefined;
    });
    await sync.reload();
    expect(firstLoad).toHaveBeenCalledWith([circle]);
    // Only the very first load on this phone: later reloads are ordinary.
    await sync.reload();
    expect(firstLoad).toHaveBeenCalledTimes(1);
  });

  it('drops an event circle that ended early (the event names no circle: the list tells)', async () => {
    const { circle, api, queryClient, store, sync } = setup();
    await sync.reload();
    expect(store.knownCircles()).toEqual([circle.id]);
    api.list.mockResolvedValueOnce([]);
    await sync.apply([{ type: 'circles.reload' }]);
    expect(queryClient.getQueryData(circlesKey)).toEqual([]);
    // Its keys are thrown away with it.
    expect(store.knownCircles()).toEqual([]);
  });

  it('says nothing to a brand-new account (no circles yet)', async () => {
    const { api, sync, firstLoad } = setup();
    api.list.mockResolvedValueOnce([]);
    await sync.reload();
    expect(firstLoad).not.toHaveBeenCalled();
  });

  it('says which circles are gone only as the server said it, never from the cache (Faz 9 W4)', async () => {
    const { circle, queryClient, sync, gone } = setup();
    const other = randomUuid();
    // A circle fetched before the list arrived: the cache holds it alone, nothing is gone.
    await sync.refresh(circle.id);
    expect(queryClient.getQueryData<Circle[]>(circlesKey)?.map((c) => c.id)).toEqual([circle.id]);
    expect(gone).not.toHaveBeenCalled();

    // The full list: whatever it lacks is gone, what it has is not.
    await sync.reload();
    const isGone = gone.mock.calls.at(-1)?.[0];
    expect(isGone?.(other)).toBe(true);
    expect(isGone?.(circle.id)).toBe(false);

    // One circle gone (left, removed, an event over): that one only.
    gone.mockClear();
    sync.drop(circle.id);
    const dropped = gone.mock.calls.at(-1)?.[0];
    expect(dropped?.(circle.id)).toBe(true);
    expect(dropped?.(other)).toBe(false);
  });

  it('reload drops circles this phone still had keys for but is no longer in', async () => {
    const { circle, api, store, sync } = setup();
    await sync.adopt(circle);
    api.list.mockResolvedValueOnce([]);
    await sync.reload();
    expect(store.knownCircles()).toEqual([]);
  });

  it('announces what other people did, but not the past on the very first load', async () => {
    const { me, bob, circle, api, sync, notify } = setup();
    await sync.reload();
    expect(notify).not.toHaveBeenCalled();

    // An invitation to a group arrives.
    const invitation: Circle = {
      ...circle,
      id: randomUuid(),
      kind: 'family',
      name: 'Aile',
      myStatus: 'invited',
      members: [{ ...card(me), status: 'invited', device: null }, card(bob)],
    };
    api.get.mockResolvedValueOnce(invitation);
    await sync.apply([
      { type: 'circle.changed', circleId: invitation.id, epoch: invitation.epoch },
    ]);
    expect(notify).toHaveBeenLastCalledWith([
      { kind: 'invited', circleId: invitation.id, pair: false, from: 'Test', circleName: 'Aile' },
    ]);

    // Bob shows up with another identity key (new phone, or someone in between).
    const bobAgain = { userId: bob.userId, device: generateDeviceKeys(randomUuid()) };
    api.get.mockResolvedValueOnce({ ...circle, epoch: 3, members: [card(me), card(bobAgain)] });
    await sync.apply([{ type: 'circle.changed', circleId: circle.id, epoch: 3 }]);
    expect(notify).toHaveBeenLastCalledWith([
      { kind: 'keyChanged', circleId: circle.id, names: ['Test'] },
    ]);
  });
});

// A person is forgotten (features/location/forget-person.ts) when the LAST circle this phone shares
// with them goes, and not a moment before.
describe('people no circle is shared with any more', () => {
  /** Two circles with Bob in both, the full list loaded. */
  async function withBobTwice() {
    const s = setup();
    const friends: Circle = { ...s.circle, id: randomUuid(), kind: 'friends', name: 'Ev' };
    s.api.list.mockResolvedValue([s.circle, friends]);
    await s.sync.reload();
    return { ...s, friends };
  }
  const bobAlone = (s: { bob: { userId: string; device: { deviceId: string } } }) => [
    { userId: s.bob.userId, deviceIds: [s.bob.device.deviceId] },
  ];

  it('tells nothing while one shared circle remains, and tells once when the last one goes', async () => {
    const s = await withBobTwice();
    expect(s.store.knownPeople()).toEqual({ [s.bob.userId]: [s.bob.device.deviceId] });

    await s.sync.apply([{ type: 'circle.gone', circleId: s.circle.id }]);
    expect(s.departed).not.toHaveBeenCalled();
    expect(s.store.knownPeople()).toEqual({ [s.bob.userId]: [s.bob.device.deviceId] });

    await s.sync.apply([{ type: 'circle.gone', circleId: s.friends.id }]);
    expect(s.departed).toHaveBeenCalledTimes(1);
    expect(s.departed).toHaveBeenCalledWith(bobAlone(s));
    expect(s.store.knownPeople()).toEqual({});
  });

  it('when the person leaves or is removed: only when no other shared circle has them', async () => {
    const s = await withBobTwice();
    const without = (circle: Circle): Circle => ({ ...circle, members: [card(s.me)] });
    s.api.get.mockImplementation((circleId: string) =>
      Promise.resolve(without(circleId === s.circle.id ? s.circle : s.friends)),
    );

    await s.sync.apply([{ type: 'circle.changed', circleId: s.circle.id, epoch: 3 }]);
    expect(s.departed).not.toHaveBeenCalled();

    await s.sync.apply([{ type: 'circle.changed', circleId: s.friends.id, epoch: 3 }]);
    expect(s.departed).toHaveBeenCalledTimes(1);
    expect(s.departed).toHaveBeenCalledWith(bobAlone(s));
  });

  it('when this phone removes them itself (the circle comes back from the action)', async () => {
    const s = await withBobTwice();
    await s.sync.adopt({ ...s.circle, members: [card(s.me)] });
    expect(s.departed).not.toHaveBeenCalled();
    await s.sync.adopt({ ...s.friends, members: [card(s.me)] });
    expect(s.departed).toHaveBeenCalledWith(bobAlone(s));
  });

  it('when this phone leaves the circles (leave, decline, an event over)', async () => {
    const s = await withBobTwice();
    s.sync.drop(s.circle.id);
    expect(s.departed).not.toHaveBeenCalled();
    s.sync.drop(s.friends.id);
    expect(s.departed).toHaveBeenCalledWith(bobAlone(s));
  });

  it('when a circle ends and the list is loaded again (circles.reload)', async () => {
    const s = await withBobTwice();
    s.api.list.mockResolvedValueOnce([s.friends]);
    await s.sync.apply([{ type: 'circles.reload' }]);
    expect(s.departed).not.toHaveBeenCalled();
    s.api.list.mockResolvedValueOnce([]);
    await s.sync.apply([{ type: 'circles.reload' }]);
    expect(s.departed).toHaveBeenCalledWith(bobAlone(s));
  });

  it('when they left while the app was closed: found from what was remembered, at the first list', async () => {
    const s = await withBobTwice();
    // The phone starts again with the same vault. Before the list is loaded the cache holds some
    // circles at most, so nothing counts as having left...
    const again = s.restart();
    again.sync.drop(s.circle.id);
    again.sync.drop(s.friends.id);
    expect(s.departed).not.toHaveBeenCalled();
    // ...the full list says Bob is in none of them.
    s.api.list.mockResolvedValueOnce([]);
    await again.sync.reload();
    expect(s.departed).toHaveBeenCalledTimes(1);
    expect(s.departed).toHaveBeenCalledWith(bobAlone(s));
  });

  it('remembers every phone a person was met with, and tells all of them', async () => {
    const s = await withBobTwice();
    const bobAgain = { userId: s.bob.userId, device: generateDeviceKeys(randomUuid()) };
    s.api.get.mockImplementation((circleId: string) =>
      Promise.resolve({
        ...(circleId === s.circle.id ? s.circle : s.friends),
        members: [card(s.me), card(bobAgain)],
      }),
    );
    await s.sync.apply([
      { type: 'circle.changed', circleId: s.circle.id, epoch: 3 },
      { type: 'circle.changed', circleId: s.friends.id, epoch: 3 },
    ]);
    s.api.list.mockResolvedValueOnce([]);
    await s.sync.reload();
    const [people] = s.departed.mock.calls.at(-1) ?? [];
    expect(people?.[0]?.deviceIds).toEqual(
      expect.arrayContaining([s.bob.device.deviceId, bobAgain.device.deviceId]),
    );
  });

  it('does not count someone only invited, or a circle this phone is only invited to', async () => {
    const s = setup();
    const carol = somebody();
    const invitedMember: Circle = {
      ...s.circle,
      members: [card(s.me), { ...card(carol), status: 'invited', device: null }],
    };
    const invitedMe: Circle = {
      ...s.circle,
      id: randomUuid(),
      myStatus: 'invited',
      members: [{ ...card(s.me), status: 'invited', device: null }, card(carol)],
    };
    s.api.list.mockResolvedValue([invitedMember, invitedMe]);
    await s.sync.reload();
    expect(s.store.knownPeople()).toEqual({});
    expect(s.departed).not.toHaveBeenCalled();
  });

  it('starts over for someone who is shared with again', async () => {
    const s = await withBobTwice();
    s.sync.drop(s.circle.id);
    s.sync.drop(s.friends.id);
    expect(s.departed).toHaveBeenCalledTimes(1);
    s.api.list.mockResolvedValue([s.circle]);
    await s.sync.reload();
    expect(s.store.knownPeople()).toEqual({ [s.bob.userId]: [s.bob.device.deviceId] });
    s.sync.drop(s.circle.id);
    expect(s.departed).toHaveBeenCalledTimes(2);
  });

  it('keeps them remembered when forgetting failed, and tries again at the next change', async () => {
    const s = await withBobTwice();
    s.departed.mockImplementationOnce(() => {
      throw new Error('vault closed');
    });
    s.sync.drop(s.circle.id);
    // The circle operation itself goes through; the person is still on the list.
    s.sync.drop(s.friends.id);
    expect(s.departed).toHaveBeenCalledTimes(1);
    expect(s.store.knownPeople()).toEqual({ [s.bob.userId]: [s.bob.device.deviceId] });

    s.api.list.mockResolvedValueOnce([]);
    await s.sync.reload();
    expect(s.departed).toHaveBeenCalledTimes(2);
    expect(s.store.knownPeople()).toEqual({});
  });

  it('never touches the trust record: a changed key is noticed when they are met again', async () => {
    const s = await withBobTwice();
    s.sync.drop(s.circle.id);
    s.sync.drop(s.friends.id);
    expect(s.departed).toHaveBeenCalledTimes(1);
    expect(s.store.identity(s.bob.userId)).toEqual({
      key: s.circle.members[1]?.device?.bundle.identityKey,
      verified: false,
      changedTo: null,
    });

    // The same person is met again, with another identity key: it is NOT taken for a first use.
    const bobAgain = { userId: s.bob.userId, device: generateDeviceKeys(randomUuid()) };
    const back: Circle = { ...s.circle, members: [card(s.me), card(bobAgain)] };
    expect(s.store.observe(back)).toEqual([s.bob.userId]);
    expect(s.store.trust(s.bob.userId)).toBe('changed');
  });
});
