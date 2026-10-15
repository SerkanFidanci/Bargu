import {
  decryptHistory,
  type DeviceKeys,
  encryptHistory,
  verifyDeviceKeyBundle,
} from '@bargu/crypto';
import {
  type Circle,
  HISTORY_SLOT_MS,
  type HistoryRecord,
  historySlot,
  type MessageEnvelope,
  trailPointSchema,
} from '@bargu/schemas';
import { z } from 'zod';

import type { KeyStore } from '../keys/key-store';
import type { Fix } from '../location/send';
import type { KeyValueStore } from '../storage/vault';
import {
  closeDue,
  fromPoint,
  type Piece,
  recordFix,
  stillKept,
  type TracePoint,
  type TrailCircle,
  withFix,
} from './trail-model';

export interface HistoryApi {
  /** Rejects with the API error when refused. */
  put: (circleId: string, slot: number, envelope: MessageEnvelope) => Promise<void>;
  list: (circleId: string, userId: string, from: number, to: number) => Promise<HistoryRecord[]>;
  remove: (circleId: string) => Promise<void>;
}

export interface HistoryDeps {
  api: HistoryApi;
  keys: () => KeyStore;
  device: () => DeviceKeys | null;
  userId: () => string | null;
  /** Circles that get this phone's history now: location shared exactly, history on. */
  recording: (now: number) => readonly TrailCircle[];
  circles: () => readonly Circle[];
  store: () => KeyValueStore;
  /** The server said no for good (not a member, a bad piece): it is not sent again. */
  refused: (error: unknown) => boolean;
  now?: () => number;
}

/** The pieces being written, one per circle. */
const OPEN_KEY = 'history:open:v1';
/** Finished pieces waiting to go up, one key each: `history:out:{circleId}:{slot}`. */
const OUT_PREFIX = 'history:out:';
/** This phone's own trail, one key per quarter hour: `history:mine:{slot}`. */
const MINE_PREFIX = 'history:mine:';
/** Circles whose copy on the server is still to be deleted (history turned off while offline). */
const FORGET_PREFIX = 'history:forget:';

const pieceSchema = z
  .object({
    circleId: z.string(),
    slot: z.number(),
    epoch: z.number(),
    points: z.array(trailPointSchema),
  })
  .strict();
const openSchema = z.record(z.string(), pieceSchema);
const pointsSchema = z.array(trailPointSchema);

function read<T>(store: KeyValueStore, key: string, schema: z.ZodType<T>, empty: T): T {
  const raw = store.get(key);
  if (raw === undefined) return empty;
  const parsed = schema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : empty;
}

/**
 * Location history on the phone (docs/ADR/0019). Each position is written down, a point every
 * 25 m or 5 minutes, for every circle that gets this phone's history (exact location shared,
 * history on) and for the user's own view; each finished quarter hour is sealed for its circle with
 * the history key of the epoch it began in and sent. Pieces wait in the vault while offline, as
 * long as the server would keep them. Others' history is fetched, opened with the history keys this phone kept, and checked:
 * signed by the member's current phone and filed under the quarter hour it covers.
 */
export function createHistory(deps: HistoryDeps) {
  const now = deps.now ?? Date.now;
  let flushing: Promise<void> | null = null;

  const outKey = (piece: Pick<Piece, 'circleId' | 'slot'>) =>
    `${OUT_PREFIX}${piece.circleId}:${String(piece.slot)}`;

  function queue(pieces: readonly Piece[]): void {
    const store = deps.store();
    for (const piece of pieces) store.set(outKey(piece), JSON.stringify(piece));
  }

  function outbox(): Piece[] {
    const store = deps.store();
    return store
      .keys()
      .filter((key) => key.startsWith(OUT_PREFIX))
      .flatMap((key) => {
        const raw = store.get(key);
        const parsed = raw === undefined ? null : pieceSchema.safeParse(JSON.parse(raw));
        if (parsed?.success !== true) {
          store.delete(key);
          return [];
        }
        return [parsed.data];
      })
      .sort((a, b) => a.slot - b.slot);
  }

  /** Seals a piece with its epoch's key (null: that key is gone, the piece cannot go). */
  function seal(piece: Piece, device: DeviceKeys): MessageEnvelope | null {
    const keys = deps.keys();
    const circle = deps.circles().find((candidate) => candidate.id === piece.circleId);
    const epoch = { id: piece.circleId, epoch: piece.epoch };
    const senderKey =
      keys.storedOwnKey(piece.circleId, piece.epoch) ??
      (circle?.epoch === piece.epoch ? keys.ownKey(epoch) : null);
    if (senderKey === null) return null;
    return encryptHistory({
      state: { senderKey, nextSeq: keys.reserveSeq(epoch) },
      sender: device,
      payload: { kind: 'trail', from: piece.slot, points: piece.points, ts: now() },
    }).envelope;
  }

  async function sendAll(): Promise<void> {
    const device = deps.device();
    if (device === null) return;
    const store = deps.store();
    for (const piece of outbox()) {
      const envelope = stillKept(piece, now()) ? seal(piece, device) : null;
      if (envelope === null) {
        store.delete(outKey(piece));
        continue;
      }
      try {
        await deps.api.put(piece.circleId, piece.slot, envelope);
        store.delete(outKey(piece));
      } catch (error) {
        if (deps.refused(error)) {
          store.delete(outKey(piece));
          continue;
        }
        // Offline or busy: everything waits for the next try, in order.
        return;
      }
    }
  }

  /** This phone's own trail between two moments (its own view, never sent as such). */
  function mine(from: number, to: number): TracePoint[] {
    const store = deps.store();
    const points: TracePoint[] = [];
    for (let slot = historySlot(from); slot < to; slot += HISTORY_SLOT_MS) {
      const held = read(store, `${MINE_PREFIX}${String(slot)}`, pointsSchema, []);
      points.push(...held.map((point) => fromPoint(point, slot)));
    }
    return points.filter((point) => point.at >= from && point.at < to);
  }

  /** Quarter hours of the own trail older than the server keeps go too. */
  function prune(): void {
    const store = deps.store();
    for (const key of store.keys()) {
      if (!key.startsWith(MINE_PREFIX)) continue;
      if (!stillKept({ slot: Number(key.slice(MINE_PREFIX.length)) }, now())) store.delete(key);
    }
  }

  /** Deletes a circle's copy on the server; the wish stays until that went through. */
  async function deleteCopy(circleId: string): Promise<boolean> {
    try {
      await deps.api.remove(circleId);
      deps.store().delete(`${FORGET_PREFIX}${circleId}`);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Deletes what waited to be deleted, finishes quarter hours that ended and sends what waits
   * (after connecting, or a new piece).
   */
  function flush(): Promise<void> {
    flushing ??= (async () => {
      try {
        const store = deps.store();
        for (const key of store.keys()) {
          if (key.startsWith(FORGET_PREFIX)) await deleteCopy(key.slice(FORGET_PREFIX.length));
        }
        const due = closeDue(read(store, OPEN_KEY, openSchema, {}), now());
        if (due.finished.length > 0) {
          store.set(OPEN_KEY, JSON.stringify(due.open));
          queue(due.finished);
        }
        await sendAll();
      } finally {
        flushing = null;
      }
    })();
    return flushing;
  }

  return {
    /** A new position of this phone: written down, and finished quarter hours sent. */
    fix(fix: Fix): Promise<void> {
      const circles = deps.recording(now());
      const store = deps.store();
      const open = read(store, OPEN_KEY, openSchema, {});
      if (circles.length === 0 && Object.keys(open).length === 0) return Promise.resolve();
      const recorded = recordFix(open, fix, circles);
      store.set(OPEN_KEY, JSON.stringify(recorded.open));
      if (circles.length > 0) {
        const slot = historySlot(fix.ts);
        const key = `${MINE_PREFIX}${String(slot)}`;
        store.set(key, JSON.stringify(withFix(read(store, key, pointsSchema, []), fix, slot)));
      }
      if (recorded.finished.length === 0) return Promise.resolve();
      queue(recorded.finished);
      prune();
      return flush();
    },

    flush,

    mine,

    /**
     * A member's history between two moments: their own trail for this phone's user, else the
     * pieces the server holds (from when this phone's user joined), opened and checked.
     */
    async load(circleId: string, userId: string, from: number, to: number): Promise<TracePoint[]> {
      if (userId === deps.userId()) return mine(from, to);
      const keys = deps.keys();
      const member = deps
        .circles()
        .find((circle) => circle.id === circleId)
        ?.members.find((candidate) => candidate.userId === userId);
      const card = member?.device;
      if (member === undefined || card === undefined || card === null || !keys.trusted(member)) {
        return [];
      }
      const sender = verifyDeviceKeyBundle(card.bundle);
      const points: TracePoint[] = [];
      for (const record of await deps.api.list(circleId, userId, from, to)) {
        const { envelope } = record;
        // Pieces of an earlier phone of theirs cannot be checked any more.
        if (envelope.senderDeviceId !== sender.deviceId) continue;
        const historyKey = keys.historyKey(circleId, envelope.epoch, envelope.senderDeviceId);
        if (historyKey === null) continue;
        try {
          const trail = decryptHistory({ envelope, historyKey, sender });
          if (trail.from !== record.from) continue;
          points.push(...trail.points.map((point) => fromPoint(point, trail.from)));
        } catch {
          // Forged or damaged: left out.
        }
      }
      return points.filter((point) => point.at >= from && point.at < to);
    },

    /**
     * History turned off for a circle (one tap, BARGU_PLAN): nothing more is written or sent there,
     * and its copy on the server is deleted. False when the server could not be reached: the
     * deletion is tried again after every connection until it goes through.
     */
    async forget(circleId: string): Promise<boolean> {
      const store = deps.store();
      const open = read(store, OPEN_KEY, openSchema, {});
      store.set(
        OPEN_KEY,
        JSON.stringify(Object.fromEntries(Object.entries(open).filter(([id]) => id !== circleId))),
      );
      for (const piece of outbox()) {
        if (piece.circleId === circleId) store.delete(outKey(piece));
      }
      store.set(`${FORGET_PREFIX}${circleId}`, '1');
      return deleteCopy(circleId);
    },

    /** Sign-out: the vault goes with everything in it; nothing in memory to keep. */
    reset(): void {
      flushing = null;
    },
  };
}

export type History = ReturnType<typeof createHistory>;
