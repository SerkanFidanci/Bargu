import {
  createSenderKeyDistribution,
  type DeviceKeys,
  fromBase64url,
  generateSenderKey,
  openSenderKeyDistribution,
  type SenderKey,
  toBase64url,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import type { Circle, MemberCard, SenderKeyDistribution } from '@bargu/schemas';
import { z } from 'zod';

import type { KeyValueStore } from '../storage/vault';

/**
 * The protocol accepts the current epoch and the two before it (PROTOCOL §5); older keys are
 * deleted and older distributions refused, so a server replaying old ones cannot bring them back.
 */
export const RETAINED_EPOCHS = 2;

const ownSchema = z.object({ key: z.string(), sentTo: z.array(z.string()) }).strict();
const identitySchema = z
  .object({ key: z.string(), verified: z.boolean(), changedTo: z.string().nullable() })
  .strict();
export type KnownIdentity = z.infer<typeof identitySchema>;

const k = {
  own: (circleId: string, epoch: number) => `own:${circleId}:${String(epoch)}`,
  received: (circleId: string, epoch: number, senderDeviceId: string) =>
    `recv:${circleId}:${String(epoch)}:${senderDeviceId}`,
  floor: (circleId: string) => `floor:${circleId}`,
  identity: (userId: string) => `identity:${userId}`,
};

function read<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>): T | null {
  const raw = store.get(key);
  if (raw === undefined) return null;
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** What a member's current device bundle says, once checked (signature over the DH key). */
function memberKeys(member: MemberCard) {
  return member.device === null ? null : verifyDeviceKeyBundle(member.device.bundle);
}

/**
 * Local store and rules for sender keys (PROTOCOL §4) and the identities behind them.
 *
 * Identity keys are trusted on first use and remembered. When a member's identity key later
 * changes (new phone, or someone in the middle), nothing is sent to or accepted from them until
 * the user acknowledges the change (BARGU_PLAN §3.1, "key değişince uyarı"); comparing safety
 * numbers marks an identity as verified.
 */
export class KeyStore {
  constructor(
    private readonly store: KeyValueStore,
    private readonly me: { userId: string; device: DeviceKeys },
  ) {}

  /** Whether this store is for that account on that device (a new sign-in needs a new one). */
  belongsTo(userId: string, deviceId: string): boolean {
    return userId === this.me.userId && deviceId === this.me.device.deviceId;
  }

  isMe(userId: string): boolean {
    return userId === this.me.userId;
  }

  /** Records the circle's epoch (never going back) and every member's identity key. */
  observe(circle: Circle): void {
    const floorKey = k.floor(circle.id);
    const floor = Number(this.store.get(floorKey) ?? 0);
    if (circle.epoch > floor) this.store.set(floorKey, String(circle.epoch));
    for (const member of circle.members) {
      if (member.userId === this.me.userId || member.device === null) continue;
      const seen = member.device.bundle.identityKey;
      const known = this.identity(member.userId);
      if (known === null) {
        this.saveIdentity(member.userId, { key: seen, verified: false, changedTo: null });
      } else if (known.key !== seen && known.changedTo !== seen) {
        this.saveIdentity(member.userId, { ...known, changedTo: seen });
      } else if (known.key === seen && known.changedTo !== null) {
        // Back to the key we knew (e.g. the server stopped substituting one).
        this.saveIdentity(member.userId, { ...known, changedTo: null });
      }
    }
  }

  identity(userId: string): KnownIdentity | null {
    return read(this.store, k.identity(userId), identitySchema);
  }

  /** How far the user can trust a member's keys: compared in person, first seen, or changed. */
  trust(userId: string): 'verified' | 'unverified' | 'changed' {
    const known = this.identity(userId);
    if ((known?.changedTo ?? null) !== null) return 'changed';
    return known?.verified === true ? 'verified' : 'unverified';
  }

  /** Circles this phone holds key state for (to drop the ones that are gone after a reload). */
  knownCircles(): string[] {
    return this.store
      .keys()
      .filter((key) => key.startsWith('floor:'))
      .map((key) => key.slice('floor:'.length));
  }

  /** Members whose identity key changed and who are on hold until the user acknowledges it. */
  changedIdentities(circle: Circle): MemberCard[] {
    return circle.members.filter(
      (member) =>
        member.userId !== this.me.userId &&
        (this.identity(member.userId)?.changedTo ?? null) !== null,
    );
  }

  /** The user accepted a member's new identity key: it becomes the known one (not verified). */
  acknowledgeChange(userId: string): void {
    const changedTo = this.identity(userId)?.changedTo ?? null;
    if (changedTo === null) return;
    this.saveIdentity(userId, { key: changedTo, verified: false, changedTo: null });
  }

  /**
   * Safety numbers matched for this identity key (QR scanned in person): verified until it changes.
   * Also settles a pending change when the scan was of the new key (proof it is really theirs).
   */
  markVerified(userId: string, identityKey: string): void {
    const known = this.identity(userId);
    if (known === null) return;
    if (
      known.changedTo === identityKey ||
      (known.changedTo === null && known.key === identityKey)
    ) {
      this.saveIdentity(userId, { key: identityKey, verified: true, changedTo: null });
    }
  }

  /** A member we may exchange keys with: their current key is the one we know. */
  trusted(member: MemberCard): boolean {
    if (member.device === null) return false;
    const known = this.identity(member.userId);
    return (
      known !== null && known.changedTo === null && known.key === member.device.bundle.identityKey
    );
  }

  /** This device's sender key for the circle's current epoch, created on first use. */
  ownKey(circle: Circle): SenderKey {
    const stored = read(this.store, k.own(circle.id, circle.epoch), ownSchema);
    if (stored !== null) {
      return {
        circleId: circle.id,
        epoch: circle.epoch,
        senderDeviceId: this.me.device.deviceId,
        key: fromBase64url(stored.key, 32),
      };
    }
    const fresh = generateSenderKey({
      circleId: circle.id,
      epoch: circle.epoch,
      senderDeviceId: this.me.device.deviceId,
    });
    this.store.set(
      k.own(circle.id, circle.epoch),
      JSON.stringify({ key: toBase64url(fresh.key), sentTo: [] }),
    );
    return fresh;
  }

  /** Copies of our current sender key still owed to trusted active members. */
  pendingDistributions(circle: Circle): SenderKeyDistribution[] {
    if (circle.myStatus !== 'active') return [];
    const senderKey = this.ownKey(circle);
    const sentTo = new Set(
      read(this.store, k.own(circle.id, circle.epoch), ownSchema)?.sentTo ?? [],
    );
    return circle.members.flatMap((member) => {
      if (member.userId === this.me.userId || member.status !== 'active') return [];
      if (!this.trusted(member)) return [];
      const recipient = memberKeys(member);
      if (recipient === null || sentTo.has(recipient.deviceId)) return [];
      return [createSenderKeyDistribution({ senderKey, sender: this.me.device, recipient })];
    });
  }

  /** The server stored these copies: they are not sent again for this epoch. */
  markSent(circle: Circle, distributions: SenderKeyDistribution[]): void {
    const key = k.own(circle.id, circle.epoch);
    const stored = read(this.store, key, ownSchema);
    if (stored === null) return;
    const sentTo = new Set([...stored.sentTo, ...distributions.map((d) => d.recipientDeviceId)]);
    this.store.set(key, JSON.stringify({ ...stored, sentTo: [...sentTo] }));
  }

  /**
   * Opens copies addressed to this device. Refused: epochs below the retained window, a second
   * copy for a slot already filled (the first one stays), and senders that are not a trusted
   * member's current device. Returns how many new keys were stored.
   */
  accept(circle: Circle, distributions: SenderKeyDistribution[]): number {
    const floor = Number(this.store.get(k.floor(circle.id)) ?? circle.epoch);
    let added = 0;
    for (const distribution of distributions) {
      if (distribution.circleId !== circle.id) continue;
      if (distribution.epoch < floor - RETAINED_EPOCHS || distribution.epoch > circle.epoch)
        continue;
      const slot = k.received(circle.id, distribution.epoch, distribution.senderDeviceId);
      if (this.store.get(slot) !== undefined) continue;
      const sender = circle.members.find(
        (member) => member.device?.bundle.deviceId === distribution.senderDeviceId,
      );
      if (sender === undefined || !this.trusted(sender)) continue;
      const senderKeys = memberKeys(sender);
      if (senderKeys === null) continue;
      try {
        const opened = openSenderKeyDistribution({
          distribution,
          recipient: this.me.device,
          sender: senderKeys,
        });
        this.store.set(slot, toBase64url(opened.key));
        added += 1;
      } catch {
        // Forged or damaged: dropped, the sender's next upload will be tried again.
      }
    }
    return added;
  }

  /** A sender's key for an epoch, if we hold it (Faz 5 decrypts locations with it). */
  receivedKey(circleId: string, epoch: number, senderDeviceId: string): SenderKey | null {
    const raw = this.store.get(k.received(circleId, epoch, senderDeviceId));
    return raw === undefined
      ? null
      : { circleId, epoch, senderDeviceId, key: fromBase64url(raw, 32) };
  }

  /** Whether every trusted active member's key for the current epoch has arrived, and ours went out. */
  readiness(circle: Circle): { ready: boolean; waitingFor: number } {
    const others = circle.members.filter(
      (member) =>
        member.userId !== this.me.userId && member.status === 'active' && member.device !== null,
    );
    const sentTo = new Set(
      read(this.store, k.own(circle.id, circle.epoch), ownSchema)?.sentTo ?? [],
    );
    const waitingFor = others.filter((member) => {
      const deviceId = member.device?.bundle.deviceId ?? '';
      return this.receivedKey(circle.id, circle.epoch, deviceId) === null || !sentTo.has(deviceId);
    }).length;
    return { ready: waitingFor === 0, waitingFor };
  }

  /** Drops keys of epochs the protocol no longer accepts, and everything of a circle we left. */
  prune(circleId: string, currentEpoch: number | null): void {
    for (const key of this.store.keys()) {
      const parts = key.split(':');
      if ((parts[0] !== 'own' && parts[0] !== 'recv') || parts[1] !== circleId) continue;
      const epoch = Number(parts[2]);
      if (currentEpoch === null || epoch < currentEpoch - RETAINED_EPOCHS) this.store.delete(key);
    }
    if (currentEpoch === null) this.store.delete(k.floor(circleId));
  }

  private saveIdentity(userId: string, identity: KnownIdentity): void {
    this.store.set(k.identity(userId), JSON.stringify(identity));
  }
}
