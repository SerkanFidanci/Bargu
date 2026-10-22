/** Epochs per (circle, sender) still accepted: the newest and the one before (in-flight messages). */
const RETAINED_EPOCHS = 2;
/** How far behind the highest `seq` a message may arrive out of order and still be accepted once. */
export const REPLAY_WINDOW = 64;

interface EpochWindow {
  /** Highest `seq` accepted in this epoch. */
  max: number;
  /** Accepted sequence numbers in (max - REPLAY_WINDOW, max), for out-of-order arrivals. */
  seen: number[];
}

interface SenderEntry {
  /** Highest epoch accepted from this sender in this circle; older epochs below the floor are dead. */
  newestEpoch: number;
  epochs: Record<string, EpochWindow>;
}

/** Serialisable state, keyed by `${circleId}/${senderDeviceId}`. */
export type ReplayState = Record<string, SenderEntry>;

const entryKey = (circleId: string, senderDeviceId: string) => `${circleId}/${senderDeviceId}`;

/** Deep copy (plain JSON data), so callers never share mutable state with the guard. */
const copy = (state: ReplayState): ReplayState => JSON.parse(JSON.stringify(state)) as ReplayState;

/** Where a message stands relative to what this receiver has already accepted. */
export type ReplayVerdict =
  /** Never seen and newer than anything accepted from this sender in this circle. */
  | 'latest'
  /** Never seen, but older than an accepted message (reordered in transit). */
  | 'reordered'
  /** Already accepted, outside the window, or from an epoch below the floor. */
  | 'replay';

/**
 * Replay protection per (circle, sender device). Within an epoch it is a sliding window (as in
 * IPsec / DTLS): messages may arrive out of order but each `seq` is accepted at most once. Across
 * epochs it keeps a floor: once epoch N is accepted, anything from epoch N - 2 or older is
 * rejected even if its sender key is still stored. Persist `toJSON()` with the rest of the
 * encrypted local cache so restarts do not reopen the window.
 */
export class ReplayGuard {
  private readonly entries = new Map<string, SenderEntry>();

  constructor(state: ReplayState = {}) {
    for (const [key, entry] of Object.entries(copy(state))) this.entries.set(key, entry);
  }

  check(circleId: string, senderDeviceId: string, epoch: number, seq: number): ReplayVerdict {
    const entry = this.entries.get(entryKey(circleId, senderDeviceId));
    if (entry === undefined || epoch > entry.newestEpoch) return 'latest';
    if (epoch <= entry.newestEpoch - RETAINED_EPOCHS) return 'replay';
    const window = entry.epochs[String(epoch)];
    if (window === undefined) return 'reordered';
    if (seq > window.max) return epoch === entry.newestEpoch ? 'latest' : 'reordered';
    if (seq === window.max || seq <= window.max - REPLAY_WINDOW || window.seen.includes(seq)) {
      return 'replay';
    }
    return 'reordered';
  }

  /** Records a successfully decrypted message; call only after authentication succeeded. */
  accept(circleId: string, senderDeviceId: string, epoch: number, seq: number): void {
    if (this.check(circleId, senderDeviceId, epoch, seq) === 'replay') return;
    const key = entryKey(circleId, senderDeviceId);
    const entry = this.entries.get(key) ?? { newestEpoch: epoch, epochs: {} };
    if (epoch > entry.newestEpoch) {
      entry.newestEpoch = epoch;
      entry.epochs = Object.fromEntries(
        Object.entries(entry.epochs).filter(([known]) => Number(known) > epoch - RETAINED_EPOCHS),
      );
    }
    const window = entry.epochs[String(epoch)];
    if (window === undefined) {
      entry.epochs[String(epoch)] = { max: seq, seen: [] };
    } else if (seq > window.max) {
      window.seen = [...window.seen, window.max].filter((s) => s > seq - REPLAY_WINDOW);
      window.max = seq;
    } else {
      window.seen.push(seq);
    }
    this.entries.set(key, entry);
  }

  /**
   * Forgets everything accepted from these sender devices, in every circle: for a person this phone
   * shares no circle with any more, whose messages can no longer be opened (their keys are gone and
   * they are no member), so the window has nothing left to protect. Returns how many entries went.
   */
  forgetSenders(senderDeviceIds: ReadonlySet<string>): number {
    let removed = 0;
    for (const key of [...this.entries.keys()]) {
      // Circle ids are UUIDs: the first "/" ends the circle id.
      if (senderDeviceIds.has(key.slice(key.indexOf('/') + 1))) {
        this.entries.delete(key);
        removed += 1;
      }
    }
    return removed;
  }

  toJSON(): ReplayState {
    return copy(Object.fromEntries(this.entries));
  }
}
