import {
  chatKeyOf,
  createSenderKeyDistribution,
  type DeviceKeys,
  fromBase64url,
  generateSenderKey,
  historyKeyOf,
  openSenderKeyDistribution,
  type SenderKey,
  toBase64url,
} from '@bargu/crypto';
import {
  CHAT_LIFETIME_MS,
  type Circle,
  HISTORY_KEEP_MS,
  type MemberCard,
  type SenderKeyDistribution,
} from '@bargu/schemas';
import { z } from 'zod';

import { type Seen, seenSchema } from '../circles/notices';
import type { KeyValueStore } from '../storage/vault';
import { verifiedBundle } from './bundle-cache';

/**
 * The protocol accepts the current epoch and the two before it (PROTOCOL §5); older keys are
 * deleted and older distributions refused, so a server replaying old ones cannot bring them back.
 */
const RETAINED_EPOCHS = 2;

/**
 * History keys (docs/ADR/0019) of an epoch outlive its sender key by this long once the epoch is no
 * longer accepted: the history sealed in it stays readable as long as the server keeps it.
 */
export const HISTORY_KEY_KEEP_MS = HISTORY_KEEP_MS + 24 * 60 * 60_000;
const historySchema = z.object({ key: z.string(), until: z.number().optional() }).strict();
/**
 * Chat keys (docs/ADR/0035 §2) of an epoch outlive its sender key by this long once the epoch is no
 * longer accepted: an item sent in it may still arrive, or be shown, until its 24 hours are over.
 */
export const CHAT_KEY_KEEP_MS = CHAT_LIFETIME_MS + 60 * 60_000;

const ownSchema = z.object({ key: z.string(), sentTo: z.array(z.string()) }).strict();
const identitySchema = z
  .object({ key: z.string(), verified: z.boolean(), changedTo: z.string().nullable() })
  .strict();
export type KnownIdentity = z.infer<typeof identitySchema>;

/** Who this phone shares circles with → the devices they were met with (see `knownPeople`). */
const peopleSchema = z.record(z.string(), z.array(z.string()));

const k = {
  people: 'people:v1',
  own: (circleId: string, epoch: number) => `own:${circleId}:${String(epoch)}`,
  seq: (circleId: string, epoch: number) => `seq:${circleId}:${String(epoch)}`,
  received: (circleId: string, epoch: number, senderDeviceId: string) =>
    `recv:${circleId}:${String(epoch)}:${senderDeviceId}`,
  history: (circleId: string, epoch: number, senderDeviceId: string) =>
    `hist:${circleId}:${String(epoch)}:${senderDeviceId}`,
  chat: (circleId: string, epoch: number, senderDeviceId: string) =>
    `chat:${circleId}:${String(epoch)}:${senderDeviceId}`,
  floor: (circleId: string) => `floor:${circleId}`,
  identity: (userId: string) => `identity:${userId}`,
  seen: (circleId: string) => `seen:${circleId}`,
  noticesReady: 'seen:ready',
};

function read<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>): T | null {
  const raw = store.get(key);
  if (raw === undefined) return null;
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

/** What a member's current device bundle says, once checked (signature over the DH key). */
function memberKeys(member: MemberCard) {
  return member.device === null ? null : verifiedBundle(member.device.bundle);
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

  /**
   * Records the circle's epoch (never going back) and every member's identity key. Returns the
   * members whose identity key has just changed (to warn the user once).
   */
  observe(circle: Circle): string[] {
    const changed: string[] = [];
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
        changed.push(member.userId);
      } else if (known.key === seen && known.changedTo !== null) {
        // Back to the key we knew (e.g. the server stopped substituting one).
        this.saveIdentity(member.userId, { ...known, changedTo: null });
      }
    }
    return changed;
  }

  /** What the user was last shown of a circle; in-app notices compare against it. */
  seen(circleId: string): Seen | null {
    return read(this.store, k.seen(circleId), seenSchema);
  }

  setSeen(circleId: string, seen: Seen): void {
    this.store.set(k.seen(circleId), JSON.stringify(seen));
  }

  /** False until the first full load: that one only records, it does not announce the past. */
  noticesReady(): boolean {
    return this.store.get(k.noticesReady) === '1';
  }

  markNoticesReady(): void {
    this.store.set(k.noticesReady, '1');
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

  /**
   * The people this phone shares at least one circle with, each with the devices they were met with:
   * what it takes to forget a person completely once the last shared circle is gone (the other
   * records name a device, not the person behind it). Kept in step by circle-sync; empty on a phone
   * that has not loaded its circles yet.
   */
  knownPeople(): Record<string, string[]> {
    return read(this.store, k.people, peopleSchema) ?? {};
  }

  rememberPeople(people: Record<string, string[]>): void {
    this.store.set(k.people, JSON.stringify(people));
  }

  /**
   * Deletes what this phone holds from these devices, which belong to a person it shares no circle
   * with any more: their sender keys (messages and history), and their place in the lists of who
   * this phone sent its own key to; their chat keys too. Not the identity record (`identity:`): that stays on purpose,
   * it is what notices a changed key if the person is met again (docs/PROTOCOL.md).
   */
  forgetDevices(deviceIds: ReadonlySet<string>): void {
    for (const key of this.store.keys()) {
      const [kind, , , deviceId] = key.split(':');
      if ((kind === 'recv' || kind === 'hist' || kind === 'chat') && deviceId !== undefined) {
        if (deviceIds.has(deviceId)) this.store.delete(key);
      } else if (kind === 'own') {
        const stored = read(this.store, key, ownSchema);
        if (stored?.sentTo.some((sent) => deviceIds.has(sent)) === true) {
          const sentTo = stored.sentTo.filter((sent) => !deviceIds.has(sent));
          this.store.set(key, JSON.stringify({ ...stored, sentTo }));
        }
      }
    }
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

  /**
   * The next message sequence number for this device's key in a circle's epoch, already counted
   * as used (persisted before the caller encrypts: a crash never makes a number come back).
   */
  reserveSeq(circle: Pick<Circle, 'id' | 'epoch'>): number {
    const key = k.seq(circle.id, circle.epoch);
    const next = Number(this.store.get(key) ?? 0);
    this.store.set(key, String(next + 1));
    return next;
  }

  /** This device's sender key for the circle's current epoch, created on first use. */
  ownKey(circle: Pick<Circle, 'id' | 'epoch'>): SenderKey {
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

  /**
   * This device's sender key of an epoch if it is still kept (never created here): opens what this
   * phone stored on the server back then (a place, docs/ADR/0015).
   */
  storedOwnKey(circleId: string, epoch: number): SenderKey | null {
    const stored = read(this.store, k.own(circleId, epoch), ownSchema);
    return stored === null
      ? null
      : {
          circleId,
          epoch,
          senderDeviceId: this.me.device.deviceId,
          key: fromBase64url(stored.key, 32),
        };
  }

  /** Our own public keys, for opening what this device itself sealed. */
  ownPublicKeys(): { deviceId: string; identityKey: Uint8Array; dhKey: Uint8Array } {
    const { device } = this.me;
    return {
      deviceId: device.deviceId,
      identityKey: device.identity.publicKey,
      dhKey: device.dh.publicKey,
    };
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
        // Kept longer than the sender key, for the history sealed in this epoch only.
        this.store.set(
          k.history(circle.id, distribution.epoch, distribution.senderDeviceId),
          JSON.stringify({ key: toBase64url(historyKeyOf(opened).key) }),
        );
        // And for the items sent in it until their 24 hours are over (docs/ADR/0035 §2).
        this.store.set(
          k.chat(circle.id, distribution.epoch, distribution.senderDeviceId),
          JSON.stringify({ key: toBase64url(chatKeyOf(opened).key) }),
        );
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

  /**
   * The key a member's location history of an epoch opens with (docs/ADR/0019): kept two weeks
   * after the epoch's sender key is gone.
   */
  historyKey(circleId: string, epoch: number, senderDeviceId: string): SenderKey | null {
    const held = read(this.store, k.history(circleId, epoch, senderDeviceId), historySchema);
    if (held !== null) return { circleId, epoch, senderDeviceId, key: fromBase64url(held.key, 32) };
    const received = this.receivedKey(circleId, epoch, senderDeviceId);
    return received === null ? null : historyKeyOf(received);
  }

  /**
   * The key a member's items for a circle in an epoch open with (docs/ADR/0035 §2): kept 25 hours
   * after the epoch's sender key is gone. This device's own items open with its own key's.
   */
  chatKey(circleId: string, epoch: number, senderDeviceId: string): SenderKey | null {
    if (senderDeviceId === this.me.device.deviceId) {
      const own = this.storedOwnKey(circleId, epoch);
      return own === null ? null : chatKeyOf(own);
    }
    const held = read(this.store, k.chat(circleId, epoch, senderDeviceId), historySchema);
    if (held !== null) return { circleId, epoch, senderDeviceId, key: fromBase64url(held.key, 32) };
    const received = this.receivedKey(circleId, epoch, senderDeviceId);
    return received === null ? null : chatKeyOf(received);
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

  /**
   * Drops keys of epochs the protocol no longer accepts, and everything of a circle we left. History
   * keys of such epochs go two weeks later, chat keys 25 hours later.
   */
  prune(circleId: string, currentEpoch: number | null, now = Date.now()): void {
    for (const key of this.store.keys()) {
      const parts = key.split(':');
      if (parts[0] === 'hist' && parts[1] === circleId) {
        this.pruneLongKey(key, Number(parts[2]), currentEpoch, now, HISTORY_KEY_KEEP_MS);
        continue;
      }
      if (parts[0] === 'chat' && parts[1] === circleId) {
        this.pruneLongKey(key, Number(parts[2]), currentEpoch, now, CHAT_KEY_KEEP_MS);
        continue;
      }
      if (
        (parts[0] !== 'own' && parts[0] !== 'recv' && parts[0] !== 'seq') ||
        parts[1] !== circleId
      ) {
        continue;
      }
      const epoch = Number(parts[2]);
      if (currentEpoch === null || epoch < currentEpoch - RETAINED_EPOCHS) this.store.delete(key);
    }
    if (currentEpoch === null) {
      this.store.delete(k.floor(circleId));
      this.store.delete(k.seen(circleId));
    }
  }

  private pruneLongKey(
    key: string,
    epoch: number,
    currentEpoch: number | null,
    now: number,
    keepMs: number,
  ): void {
    if (currentEpoch === null) {
      this.store.delete(key);
      return;
    }
    if (epoch >= currentEpoch - RETAINED_EPOCHS) return;
    const held = read(this.store, key, historySchema);
    if (held === null || (held.until !== undefined && held.until <= now)) {
      this.store.delete(key);
    } else if (held.until === undefined) {
      this.store.set(key, JSON.stringify({ ...held, until: now + keepMs }));
    }
  }

  private saveIdentity(userId: string, identity: KnownIdentity): void {
    this.store.set(k.identity(userId), JSON.stringify(identity));
  }
}
