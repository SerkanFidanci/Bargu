import { decryptMessage, openPush, ReplayGuard, verifyDeviceKeyBundle } from '@bargu/crypto';

import { contactsOf, identityOf } from '../notifications/push-contacts';
import { DEFAULT_SHARING, type SharingSettings } from '../location/sharing';
import {
  circleOf,
  exchangeKeys,
  GALATA,
  memoryStore,
  moved,
  nth,
  somebody,
} from '../location/test-support';
import type { Place } from './place-model';
import { announcesTo, createPresence, placeEvent } from './presence';

const NOW = 1_800_000_000_000;

describe('arrivals sent by this phone', () => {
  it('reach the circle encrypted, with a notification sealed for each member', () => {
    const [ayse, bora] = [somebody(), somebody()];
    const circle = circleOf([ayse, bora]);
    exchangeKeys(circle, [ayse, bora]);
    const place: Place = {
      id: '0190f7a4-2222-7222-8222-000000000001',
      circleId: circle.id,
      version: 1,
      name: 'Okul',
      emoji: '🏫',
      lat: GALATA.lat,
      lng: GALATA.lng,
      radius: 100,
      ts: 1,
    };
    const recipients = contactsOf([circle], ayse.keys, ayse.userId).recipients[circle.id] ?? [];
    const request = placeEvent({
      circle,
      place,
      event: 'enter',
      keys: ayse.keys,
      device: ayse.device,
      recipients,
      now: NOW,
    });

    // Bora's phone, online: the message says which place, nothing else.
    const card = nth(circle.members.filter((member) => member.userId === ayse.userId)).device;
    if (card === null) throw new Error('no device');
    const senderKey = bora.keys.receivedKey(circle.id, circle.epoch, ayse.device.deviceId);
    if (senderKey === null) throw new Error('no key');
    expect(
      decryptMessage({
        envelope: request.envelope,
        senderKey,
        sender: verifyDeviceKeyBundle(card.bundle),
        replay: new ReplayGuard(),
      }),
    ).toEqual({ kind: 'place_enter', placeId: place.id, ts: NOW });

    // Bora's phone, closed: the notification opens only there, signed by Ayşe's device.
    expect(request.pushes).toHaveLength(1);
    const push = nth(request.pushes);
    expect(push.userId).toBe(bora.userId);
    expect(push.sealed).not.toContain('Okul');
    const boraContacts = contactsOf([circle], bora.keys, bora.userId);
    expect(
      openPush({
        recipient: bora.device,
        sealed: push.sealed,
        senderIdentityKey: (deviceId) => identityOf(boraContacts, deviceId),
      }),
    ).toEqual({
      senderDeviceId: ayse.device.deviceId,
      body: {
        kind: 'place',
        circleId: circle.id,
        placeId: place.id,
        event: 'enter',
        name: 'Okul',
        emoji: '🏫',
        ts: NOW,
      },
    });
  });
});

describe('noticing arrivals and departures', () => {
  const circleId = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
  const home: Place = {
    id: '0190f7a4-2222-7222-8222-000000000002',
    circleId,
    version: 1,
    name: 'Ev',
    emoji: '🏠',
    lat: GALATA.lat,
    lng: GALATA.lng,
    radius: 100,
    ts: 1,
  };

  function setup(sharing: () => SharingSettings = () => DEFAULT_SHARING) {
    const announced: string[] = [];
    const presence = createPresence({
      places: () => [home],
      circles: () => [{ id: circleId, epoch: 1, myStatus: 'active' }],
      sharing,
      store: () => store,
      announce: (_circle, place, event) => {
        announced.push(`${event}:${place.name}`);
        return Promise.resolve();
      },
      now: () => NOW,
    });
    const store = memoryStore();
    return { presence, announced };
  }

  it('records the first position quietly, then announces leaving and coming back', async () => {
    const { presence, announced } = setup();
    await presence.fix({ ...GALATA, ts: 1 });
    expect(announced).toEqual([]);
    await presence.fix(moved(GALATA, 400, 2));
    await presence.fix(moved(GALATA, 30, 3));
    expect(announced).toEqual(['exit:Ev', 'enter:Ev']);
    expect(presence.current()[home.id]).toEqual({ inside: true, since: 3 });
  });

  it('says nothing to a circle that does not get the exact location, and forgets meanwhile', async () => {
    let settings: SharingSettings = DEFAULT_SHARING;
    const { presence, announced } = setup(() => settings);
    await presence.fix({ ...GALATA, ts: 1 });
    settings = {
      ghost: 'off',
      circles: { [circleId]: { sharing: true, precision: 'neighborhood', until: null } },
    };
    await presence.fix(moved(GALATA, 400, 2));
    expect(announced).toEqual([]);
    expect(presence.current()).toEqual({});
    // Exact again, somewhere else: recorded quietly (no stale "left home").
    settings = DEFAULT_SHARING;
    await presence.fix(moved(GALATA, 500, 3));
    expect(announced).toEqual([]);
  });

  it('announces to exact, shared, non-ghost circles only', () => {
    expect(announcesTo(DEFAULT_SHARING, circleId, NOW)).toBe(true);
    expect(announcesTo({ ghost: 'freeze', circles: {} }, circleId, NOW)).toBe(false);
    expect(
      announcesTo(
        {
          ghost: 'off',
          circles: { [circleId]: { sharing: false, precision: 'exact', until: null } },
        },
        circleId,
        NOW,
      ),
    ).toBe(false);
  });
});
