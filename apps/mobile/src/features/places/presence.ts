import { type DeviceKeys, encryptMessage, fromBase64url, sealPush } from '@bargu/crypto';
import type { Circle, DevicePushes, PlaceEventRequest, PushBody } from '@bargu/schemas';
import { z } from 'zod';

import type { KeyStore } from '../keys/key-store';
import type { Fix } from '../location/send';
import { circleSharing, isSharingWith, type SharingSettings } from '../location/sharing';
import type { PushContacts } from '../notifications/push-contacts';
import type { KeyValueStore } from '../storage/vault';
import { nextPresence, type Place, type Presence } from './place-model';

/** Notifications sealed for each trusted member's device (docs/ADR/0016). */
export function sealPushes(
  recipients: PushContacts['recipients'][string],
  sender: DeviceKeys,
  body: PushBody,
): DevicePushes {
  return recipients.map((recipient) => ({
    userId: recipient.userId,
    deviceId: recipient.deviceId,
    sealed: sealPush({
      recipient: { deviceId: recipient.deviceId, dhKey: fromBase64url(recipient.dhKey, 32) },
      sender,
      body,
    }),
  }));
}

/**
 * "I arrived at / left this place", for its circle: the encrypted message for the members who
 * are online, and a sealed notification for each of the others' devices.
 */
export function placeEvent(input: {
  circle: Pick<Circle, 'id' | 'epoch'>;
  place: Place;
  event: 'enter' | 'exit';
  keys: KeyStore;
  device: DeviceKeys;
  recipients: PushContacts['recipients'][string];
  now: number;
}): PlaceEventRequest {
  const { circle, place, event, keys, device, now } = input;
  const envelope = encryptMessage({
    state: { senderKey: keys.ownKey(circle), nextSeq: keys.reserveSeq(circle) },
    sender: device,
    payload: { kind: event === 'enter' ? 'place_enter' : 'place_exit', placeId: place.id, ts: now },
  }).envelope;
  const body: PushBody = {
    kind: 'place',
    circleId: circle.id,
    placeId: place.id,
    event,
    name: place.name,
    emoji: place.emoji,
    ts: now,
  };
  return { envelope, pushes: sealPushes(input.recipients, device, body) };
}

/** Whether this phone announces its comings and goings to a circle now: exact location shared. */
export function announcesTo(settings: SharingSettings, circleId: string, now: number): boolean {
  return (
    isSharingWith(settings, circleId, now) &&
    circleSharing(settings, circleId).precision === 'exact'
  );
}

const PRESENCE_KEY = 'places:presence:v1';
const presenceSchema = z.record(
  z.string(),
  z.object({ inside: z.boolean(), since: z.number() }).strict(),
);

export interface PresenceDeps {
  places: () => readonly Place[];
  circles: () => readonly Pick<Circle, 'id' | 'epoch' | 'myStatus'>[];
  sharing: () => SharingSettings;
  store: () => KeyValueStore;
  /** Sends one arrival or departure; throws when it did not get there. */
  announce: (
    circle: Pick<Circle, 'id' | 'epoch'>,
    place: Place,
    event: 'enter' | 'exit',
  ) => Promise<void>;
  now?: () => number;
}

/**
 * Arrivals and departures, noticed by the location engine itself (docs/ADR/0015) instead of the
 * operating system's geofences: no "always" location permission, and nothing is announced while
 * the circle does not get the exact location. A circle that stops getting it forgets where this
 * phone was, so sharing again never announces a stale departure.
 */
export function createPresence(deps: PresenceDeps) {
  const now = deps.now ?? Date.now;

  function load(): Record<string, Presence> {
    const raw = deps.store().get(PRESENCE_KEY);
    const parsed = presenceSchema.safeParse(raw === undefined ? {} : JSON.parse(raw));
    return parsed.success ? parsed.data : {};
  }

  return {
    async fix(fix: Fix): Promise<void> {
      const at = now();
      const settings = deps.sharing();
      const circles = new Map(
        deps
          .circles()
          .filter((circle) => circle.myStatus === 'active')
          .map((circle) => [circle.id, circle]),
      );
      const before = load();
      const after: Record<string, Presence> = {};
      const events: {
        circle: Pick<Circle, 'id' | 'epoch'>;
        place: Place;
        event: 'enter' | 'exit';
      }[] = [];
      for (const place of deps.places()) {
        const circle = circles.get(place.circleId);
        if (circle === undefined || !announcesTo(settings, circle.id, at)) continue;
        const { presence, event } = nextPresence(before[place.id], place, fix);
        if (presence !== undefined) after[place.id] = presence;
        if (event !== null) events.push({ circle, place, event });
      }
      deps.store().set(PRESENCE_KEY, JSON.stringify(after));
      for (const { circle, place, event } of events) {
        try {
          await deps.announce(circle, place, event);
        } catch {
          // Offline: this one is lost (a late "arrived" would mislead); the next change is sent.
        }
      }
    },

    /** Where this phone is, per place id (its own "you are at home" marker). */
    current(): Record<string, Presence> {
      return load();
    },
  };
}
