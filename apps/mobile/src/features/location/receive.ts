import {
  BarguCryptoError,
  decryptMessage,
  ReplayGuard,
  type ReplayState,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import { type Circle, locPayloadSchema, type MessageEnvelope, type Payload } from '@bargu/schemas';

type StatusPayload = Extract<Payload, { kind: 'status' }>;
type ProfilePayload = Extract<Payload, { kind: 'profile' }>;
import { z } from 'zod';
import { create } from 'zustand';

import type { KeyStore } from '../keys/key-store';
import type { KeyValueStore } from '../storage/vault';

const receivedSchema = z
  .object({
    circleId: z.string(),
    userId: z.string(),
    loc: locPayloadSchema,
    receivedAt: z.number(),
  })
  .strict();

/** A member's latest location as received in one circle. */
export type ReceivedLocation = z.infer<typeof receivedSchema>;

/** Everyone's latest location per circle, keyed `${circleId}:${userId}` (screens read this). */
export const useLocations = create<Record<string, ReceivedLocation>>(() => ({}));

const REPLAY_KEY = 'replay:v1';
/**
 * The latest location of each member, kept in the encrypted vault: after a restart the replay
 * guard rightly refuses envelopes already opened, so the map starts from this copy instead.
 * Only the newest one per person and circle is kept; it never leaves the phone.
 */
const LOCATIONS_KEY = 'locations:v1';
const entryKey = (circleId: string, userId: string) => `${circleId}:${userId}`;

export type Outcome = 'shown' | 'removed' | 'bumped' | 'waiting' | 'ignored';

export interface ReceiverDeps {
  keys: () => KeyStore;
  /** Circles as currently known (cache); a circle missing here is waited for. */
  circles: () => readonly Circle[];
  store: () => KeyValueStore;
  /** A member poked this phone (BARGU_PLAN §4.3 "Dürt"). */
  onBump?: (circleId: string, userId: string, ts: number) => void;
  /** A member set or changed their status (emoji and short text). */
  onStatus?: (circleId: string, userId: string, status: StatusPayload) => void;
  /** A member's profile message (their photo key, docs/ADR/0014). */
  onProfile?: (userId: string, profile: ProfilePayload) => void;
  now?: () => number;
}

/** A member who may be on this phone's map: active in a circle this phone is active in. */
function isVisible(circles: readonly Circle[], circleId: string, userId: string): boolean {
  const circle = circles.find((candidate) => candidate.id === circleId);
  return (
    circle?.myStatus === 'active' &&
    circle.members.some((member) => member.userId === userId && member.status === 'active')
  );
}

/**
 * Opens location messages addressed to circles this phone is in (BARGU_PLAN §3.3 receiver):
 * signature, sender key and replay window checked by decryptMessage. A message whose sender key
 * has not arrived yet waits (one per sender) and is tried again after the next key sync; messages
 * from a member whose identity key changed are ignored until the user accepts the change.
 */
export function createReceiver({
  keys,
  circles,
  store,
  onBump,
  onStatus,
  onProfile,
  now = Date.now,
}: ReceiverDeps) {
  let replay: ReplayGuard | null = null;
  const waiting = new Map<string, MessageEnvelope>();

  function guard(): ReplayGuard {
    if (replay === null) {
      const raw = store().get(REPLAY_KEY);
      replay = new ReplayGuard(raw === undefined ? {} : (JSON.parse(raw) as ReplayState));
    }
    return replay;
  }

  function replaceLocations(next: Record<string, ReceivedLocation>): void {
    useLocations.setState(next, true);
    store().set(LOCATIONS_KEY, JSON.stringify(Object.values(next)));
  }

  function keep(predicate: (entry: ReceivedLocation) => boolean): void {
    const current = useLocations.getState();
    const kept = Object.fromEntries(
      Object.entries(current).filter(([, entry]) => predicate(entry)),
    );
    if (Object.keys(kept).length !== Object.keys(current).length) replaceLocations(kept);
  }

  function set(entry: ReceivedLocation): void {
    replaceLocations({
      ...useLocations.getState(),
      [entryKey(entry.circleId, entry.userId)]: entry,
    });
  }

  function remove(circleId: string, userId: string): void {
    keep((entry) => entry.circleId !== circleId || entry.userId !== userId);
  }

  function persistReplay(current: ReplayGuard): void {
    store().set(REPLAY_KEY, JSON.stringify(current.toJSON()));
  }

  function receive(envelope: MessageEnvelope): Outcome {
    const waitKey = `${envelope.circleId}:${envelope.senderDeviceId}`;
    const circle = circles().find((candidate) => candidate.id === envelope.circleId);
    const sender = circle?.members.find(
      (member) => member.device?.bundle.deviceId === envelope.senderDeviceId,
    );
    const keyStore = keys();
    const senderKey = keyStore.receivedKey(
      envelope.circleId,
      envelope.epoch,
      envelope.senderDeviceId,
    );
    const device = sender?.device ?? null;
    if (circle === undefined || sender === undefined || device === null || senderKey === null) {
      // Keys or membership not here yet: keep the newest one per sender for the next sync.
      waiting.set(waitKey, envelope);
      return 'waiting';
    }
    waiting.delete(waitKey);
    if (!keyStore.trusted(sender)) return 'ignored';
    const replayGuard = guard();
    try {
      const payload = decryptMessage({
        envelope,
        senderKey,
        sender: verifyDeviceKeyBundle(device.bundle),
        replay: replayGuard,
      });
      persistReplay(replayGuard);
      if (payload.kind === 'loc') {
        set({ circleId: circle.id, userId: sender.userId, loc: payload, receivedAt: now() });
        return 'shown';
      }
      if (payload.kind === 'share_stop') {
        remove(circle.id, sender.userId);
        return 'removed';
      }
      if (payload.kind === 'profile') {
        onProfile?.(sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'status') {
        onStatus?.(circle.id, sender.userId, payload);
        return 'shown';
      }
      if (payload.kind === 'bump') {
        onBump?.(circle.id, sender.userId, payload.ts);
        return 'bumped';
      }
      return 'ignored';
    } catch (error) {
      if (error instanceof BarguCryptoError) {
        // STALE / REPLAY / forged: the replay window may have advanced; keep it.
        persistReplay(replayGuard);
        return 'ignored';
      }
      throw error;
    }
  }

  return {
    receive,

    /** The locations this phone had before a restart (shown until fresher ones arrive). */
    restore(): void {
      const raw = store().get(LOCATIONS_KEY);
      if (raw === undefined) return;
      const parsed = z.array(receivedSchema).safeParse(JSON.parse(raw));
      if (!parsed.success) return;
      useLocations.setState(
        Object.fromEntries(
          parsed.data.map((entry) => [entryKey(entry.circleId, entry.userId), entry]),
        ),
        true,
      );
    },

    /**
     * Snapshot after (re)connecting: every member's latest envelope on the server. A location the
     * server no longer has (expired after 24 hours, taken back, member gone) goes from the map too.
     */
    receiveSnapshot(envelopes: readonly MessageEnvelope[]): void {
      for (const envelope of envelopes) receive(envelope);
      const known = circles();
      const onServer = new Set(
        envelopes.map((envelope) => `${envelope.circleId}:${envelope.senderDeviceId}`),
      );
      keep((entry) => {
        const circle = known.find((candidate) => candidate.id === entry.circleId);
        const member = circle?.members.find((candidate) => candidate.userId === entry.userId);
        const deviceId = member?.device?.bundle.deviceId;
        return deviceId !== undefined && onServer.has(`${entry.circleId}:${deviceId}`);
      });
    },

    /** After key or membership sync: messages that waited for a sender key get another try. */
    retryWaiting(): void {
      for (const envelope of [...waiting.values()]) receive(envelope);
    },

    /** The relay says a member's location is gone (left, removed, hidden). */
    gone(circleId: string, userId: string): void {
      remove(circleId, userId);
    },

    /** Circles or members changed: only active members of active circles stay on the map. */
    prune(): void {
      const known = circles();
      keep((entry) => isVisible(known, entry.circleId, entry.userId));
      for (const key of [...waiting.keys()]) {
        const circleId = key.slice(0, key.indexOf(':'));
        if (!known.some((circle) => circle.id === circleId && circle.myStatus === 'active')) {
          waiting.delete(key);
        }
      }
    },

    /** Sign-out (the vault is destroyed with everything in it). */
    reset(): void {
      replay = null;
      waiting.clear();
      useLocations.setState({}, true);
    },
  };
}

export type Receiver = ReturnType<typeof createReceiver>;

/**
 * One dot per person on the map: of their locations in different circles (each possibly at a
 * different precision), the most precise among the recent ones, else the newest.
 */
export function bestPerPerson(
  locations: Readonly<Record<string, ReceivedLocation>>,
  recentMs = 60_000,
): ReceivedLocation[] {
  const byUser = new Map<string, ReceivedLocation[]>();
  for (const entry of Object.values(locations)) {
    byUser.set(entry.userId, [...(byUser.get(entry.userId) ?? []), entry]);
  }
  return [...byUser.values()].map((entries) => {
    const newest = Math.max(...entries.map((entry) => entry.loc.ts));
    const recent = entries.filter((entry) => newest - entry.loc.ts <= recentMs);
    return recent.reduce((best, entry) => (entry.loc.acc < best.loc.acc ? entry : best));
  });
}
