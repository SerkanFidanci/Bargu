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
import { createCircleSync, useCircleKeys } from './circle-sync';
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
    get: jest.fn(() => Promise.resolve(circle)),
    uploadKeys: jest.fn<Promise<void>, [string, number, SenderKeyDistribution[]]>(() =>
      Promise.resolve(),
    ),
    keys: jest.fn(() => Promise.resolve([] as SenderKeyDistribution[])),
    rekey: jest.fn(() => Promise.resolve({ ...circle, epoch: circle.epoch + 1 })),
  };
  const store = new KeyStore(memoryStore(), me);
  const notify = jest.fn<undefined, [Notice[]]>();
  const firstLoad = jest.fn<undefined, [Circle[]]>();
  // No garbage-collection timers: they would outlive the test.
  const queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const sync = createCircleSync({
    queryClient,
    api: api as unknown as typeof circlesApi,
    keys: () => store,
    notify,
    firstLoad,
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
  return { me, bob, circle, api, store, queryClient, sync, fromBob, notify, firstLoad };
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

  it('says nothing to a brand-new account (no circles yet)', async () => {
    const { api, sync, firstLoad } = setup();
    api.list.mockResolvedValueOnce([]);
    await sync.reload();
    expect(firstLoad).not.toHaveBeenCalled();
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
