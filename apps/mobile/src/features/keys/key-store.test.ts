import {
  createSenderKeyDistribution,
  type DeviceKeys,
  exportDeviceKeyBundle,
  generateDeviceKeys,
  generateSenderKey,
  randomUuid,
  verifyDeviceKeyBundle,
  historyKeyOf,
} from '@bargu/crypto';
import type { Circle, MemberCard } from '@bargu/schemas';

import type { KeyValueStore } from '../storage/vault';
import { HISTORY_KEY_KEEP_MS, KeyStore } from './key-store';

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

function card(person: Person, status: 'active' | 'invited' = 'active'): MemberCard {
  return {
    userId: person.userId,
    role: 'member',
    status,
    username: null,
    displayName: 'Test',
    avatar: null,
    device:
      status === 'active'
        ? { platform: 'android', bundle: exportDeviceKeyBundle(person.device) }
        : null,
  };
}

function circleOf(id: string, epoch: number, members: MemberCard[]): Circle {
  return {
    id,
    kind: 'friends',
    name: 'Test',
    epoch,
    epochStartedAt: Date.now(),
    myRole: 'member',
    myStatus: 'active',
    members,
  };
}

/** A distribution of `sender`'s key for the circle's epoch, addressed to `recipient`. */
function keyFrom(sender: Person, recipient: Person, circle: Circle, epoch = circle.epoch) {
  const senderKey = generateSenderKey({
    circleId: circle.id,
    epoch,
    senderDeviceId: sender.device.deviceId,
  });
  const distribution = createSenderKeyDistribution({
    senderKey,
    sender: sender.device,
    recipient: verifyDeviceKeyBundle(exportDeviceKeyBundle(recipient.device)),
  });
  return { senderKey, distribution };
}

describe('KeyStore', () => {
  const me = somebody();
  const circleId = randomUuid();

  it('trusts identities on first sight and holds a changed one until the user accepts it', () => {
    const bob = somebody();
    const store = new KeyStore(memoryStore(), me);
    store.observe(circleOf(circleId, 1, [card(me), card(bob)]));
    expect(store.trust(bob.userId)).toBe('unverified');

    // Bob's identity key changes (new phone, or someone in the middle): nothing goes to him.
    const bobAgain = { userId: bob.userId, device: generateDeviceKeys(randomUuid()) };
    const changed = circleOf(circleId, 2, [card(me), card(bobAgain)]);
    store.observe(changed);
    expect(store.trust(bob.userId)).toBe('changed');
    expect(store.changedIdentities(changed).map((m) => m.userId)).toEqual([bob.userId]);
    expect(store.pendingDistributions(changed)).toEqual([]);

    store.acknowledgeChange(bob.userId);
    expect(store.trust(bob.userId)).toBe('unverified');
    expect(store.pendingDistributions(changed)).toHaveLength(1);
  });

  it('marks a member verified by QR, and a scan of the new key settles a change', () => {
    const bob = somebody();
    const store = new KeyStore(memoryStore(), me);
    const circle = circleOf(circleId, 1, [card(me), card(bob)]);
    store.observe(circle);
    const bobKey = card(bob).device?.bundle.identityKey ?? '';
    store.markVerified(bob.userId, 'not-his-key');
    expect(store.trust(bob.userId)).toBe('unverified');
    store.markVerified(bob.userId, bobKey);
    expect(store.trust(bob.userId)).toBe('verified');

    const bobAgain = { userId: bob.userId, device: generateDeviceKeys(randomUuid()) };
    const newKey = card(bobAgain).device?.bundle.identityKey ?? '';
    store.observe(circleOf(circleId, 2, [card(me), card(bobAgain)]));
    expect(store.trust(bob.userId)).toBe('changed');
    store.markVerified(bob.userId, newKey);
    expect(store.trust(bob.userId)).toBe('verified');
    expect(store.identity(bob.userId)?.key).toBe(newKey);
  });

  it('sends our key once per member and epoch, never to someone only invited', () => {
    const [bob, can] = [somebody(), somebody()];
    const store = new KeyStore(memoryStore(), me);
    const circle = circleOf(circleId, 1, [card(me), card(bob), card(can, 'invited')]);
    store.observe(circle);
    const pending = store.pendingDistributions(circle);
    expect(pending.map((d) => d.recipientDeviceId)).toEqual([bob.device.deviceId]);
    store.markSent(circle, pending);
    expect(store.pendingDistributions(circle)).toEqual([]);

    const next = { ...circle, epoch: 2 };
    store.observe(next);
    expect(store.pendingDistributions(next)).toHaveLength(1);
  });

  it('opens keys addressed to it from trusted members only, and never replaces one', () => {
    const [bob, mallory] = [somebody(), somebody()];
    const store = new KeyStore(memoryStore(), me);
    const circle = circleOf(circleId, 1, [card(me), card(bob)]);
    store.observe(circle);

    const first = keyFrom(bob, me, circle);
    expect(store.accept(circle, [first.distribution])).toBe(1);
    expect(store.receivedKey(circleId, 1, bob.device.deviceId)?.key).toEqual(first.senderKey.key);

    // A second key for the same slot (a replay or a swap by the server) is ignored.
    const second = keyFrom(bob, me, circle);
    expect(store.accept(circle, [second.distribution])).toBe(0);
    expect(store.receivedKey(circleId, 1, bob.device.deviceId)?.key).toEqual(first.senderKey.key);

    // Someone who is not in the circle.
    expect(store.accept(circle, [keyFrom(mallory, me, circle).distribution])).toBe(0);
  });

  it('refuses epochs the protocol no longer accepts, and future ones', () => {
    const bob = somebody();
    const store = new KeyStore(memoryStore(), me);
    const circle = circleOf(circleId, 5, [card(me), card(bob)]);
    store.observe(circle);
    expect(store.accept(circle, [keyFrom(bob, me, circle, 2).distribution])).toBe(0);
    expect(store.accept(circle, [keyFrom(bob, me, circle, 3).distribution])).toBe(1);
    expect(store.accept(circle, [keyFrom(bob, me, circle, 6).distribution])).toBe(0);
  });

  it('is ready once our key went out and every active member’s key came in', () => {
    const bob = somebody();
    const store = new KeyStore(memoryStore(), me);
    const circle = circleOf(circleId, 1, [card(me), card(bob)]);
    store.observe(circle);
    expect(store.readiness(circle)).toEqual({ ready: false, waitingFor: 1 });
    store.markSent(circle, store.pendingDistributions(circle));
    store.accept(circle, [keyFrom(bob, me, circle).distribution]);
    expect(store.readiness(circle)).toEqual({ ready: true, waitingFor: 0 });
  });

  it('drops keys of old epochs, and everything of a circle that is gone', () => {
    const bob = somebody();
    const store = new KeyStore(memoryStore(), me);
    const old = circleOf(circleId, 1, [card(me), card(bob)]);
    store.observe(old);
    store.accept(old, [keyFrom(bob, me, old).distribution]);
    store.prune(circleId, 4);
    expect(store.receivedKey(circleId, 1, bob.device.deviceId)).toBeNull();
    expect(store.knownCircles()).toEqual([circleId]);
    store.prune(circleId, null);
    expect(store.knownCircles()).toEqual([]);
  });

  it('keeps the history key of an old epoch after its sender key goes (docs/ADR/0019)', () => {
    const bob = somebody();
    const store = new KeyStore(memoryStore(), me);
    const old = circleOf(circleId, 1, [card(me), card(bob)]);
    store.observe(old);
    const { senderKey, distribution } = keyFrom(bob, me, old);
    store.accept(old, [distribution]);
    const historyKey = historyKeyOf(senderKey).key;
    expect(store.historyKey(circleId, 1, bob.device.deviceId)?.key).toEqual(historyKey);

    // Epoch 4: the sender key is gone, the history key stays, as long as the server keeps history.
    const now = 1_791_880_200_000;
    store.prune(circleId, 4, now);
    expect(store.receivedKey(circleId, 1, bob.device.deviceId)).toBeNull();
    expect(store.historyKey(circleId, 1, bob.device.deviceId)?.key).toEqual(historyKey);
    store.prune(circleId, 5, now + HISTORY_KEY_KEEP_MS - 1);
    expect(store.historyKey(circleId, 1, bob.device.deviceId)).not.toBeNull();
    store.prune(circleId, 5, now + HISTORY_KEY_KEEP_MS);
    expect(store.historyKey(circleId, 1, bob.device.deviceId)).toBeNull();

    // Leaving the circle takes them all at once.
    const current = circleOf(circleId, 5, [card(me), card(bob)]);
    store.observe(current);
    store.accept(current, [keyFrom(bob, me, current).distribution]);
    store.prune(circleId, null);
    expect(store.historyKey(circleId, 5, bob.device.deviceId)).toBeNull();
  });
});
