import {
  type DeviceKeys,
  exportDeviceKeyBundle,
  generateDeviceKeys,
  randomUuid,
} from '@bargu/crypto';
import type { Circle, MemberCard } from '@bargu/schemas';

import { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';
import type { Fix } from './send';

/** Test helpers for the location engine (imported by tests only, never by the app). */

export function memoryStore(): KeyValueStore {
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

export interface Person {
  userId: string;
  device: DeviceKeys;
  store: KeyValueStore;
  keys: KeyStore;
}

export function somebody(): Person {
  const userId = randomUuid();
  const device = generateDeviceKeys(randomUuid());
  const store = memoryStore();
  return { userId, device, store, keys: new KeyStore(store, { userId, device }) };
}

export function card(person: Person, status: 'active' | 'invited' = 'active'): MemberCard {
  return {
    userId: person.userId,
    role: 'member',
    status,
    username: null,
    displayName: 'Test',
    avatar: null,
    device: { platform: 'android', bundle: exportDeviceKeyBundle(person.device) },
  };
}

export function circleOf(members: Person[], overrides: Partial<Circle> = {}): Circle {
  return {
    id: randomUuid(),
    kind: 'friends',
    name: 'Test',
    epoch: 1,
    epochStartedAt: Date.now(),
    myRole: 'member',
    myStatus: 'active',
    members: members.map((member) => card(member)),
    ...overrides,
  };
}

/** Everyone in the circle knows everyone and holds everyone's sender key (a finished sync). */
export function exchangeKeys(circle: Circle, people: Person[]): void {
  for (const person of people) person.keys.observe(circle);
  for (const sender of people) {
    const distributions = sender.keys.pendingDistributions(circle);
    for (const recipient of people) {
      if (recipient !== sender) recipient.keys.accept(circle, distributions);
    }
    sender.keys.markSent(circle, distributions);
  }
}

/** Istanbul, Galata Tower. */
export const GALATA: Fix = { lat: 41.025_6, lng: 28.974_2, acc: 8, spd: 1.2, hdg: 90, ts: 0 };

/** A fix `metres` north of `from`, taken at `ts`. */
export function moved(from: Fix, metres: number, ts: number): Fix {
  return { ...from, lat: from.lat + metres / 111_320, ts };
}

/** The item at `index`; fails the test when there is none (instead of a non-null assertion). */
export function nth<T>(items: readonly T[], index = 0): T {
  const item = items[index];
  if (item === undefined) throw new Error(`no item at ${String(index)}`);
  return item;
}
