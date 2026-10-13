/** How many epochs per sender are remembered (current and the one before, for in-flight messages). */
const RETAINED_EPOCHS = 2;

export type ReplayState = Record<string, number>;

const keyOf = (senderDeviceId: string, epoch: number) => `${senderDeviceId}/${String(epoch)}`;

/**
 * Remembers the highest sequence number accepted per (sender device, epoch). Messages with an equal
 * or lower `seq` are replays (or stale: location is last-write-wins). Persist `toJSON()` with the
 * rest of the encrypted local cache so restarts do not reopen the replay window.
 */
export class ReplayGuard {
  private readonly lastSeq = new Map<string, number>();

  constructor(state: ReplayState = {}) {
    for (const [key, seq] of Object.entries(state)) this.lastSeq.set(key, seq);
  }

  isFresh(senderDeviceId: string, epoch: number, seq: number): boolean {
    const last = this.lastSeq.get(keyOf(senderDeviceId, epoch));
    return last === undefined || seq > last;
  }

  /** Records a successfully decrypted message; call only after authentication succeeded. */
  accept(senderDeviceId: string, epoch: number, seq: number): void {
    if (!this.isFresh(senderDeviceId, epoch, seq)) return;
    this.lastSeq.set(keyOf(senderDeviceId, epoch), seq);
    this.forgetOldEpochs(senderDeviceId, epoch);
  }

  toJSON(): ReplayState {
    return Object.fromEntries(this.lastSeq);
  }

  private forgetOldEpochs(senderDeviceId: string, newestEpoch: number): void {
    const prefix = `${senderDeviceId}/`;
    for (const key of [...this.lastSeq.keys()]) {
      if (!key.startsWith(prefix)) continue;
      const epoch = Number(key.slice(prefix.length));
      if (epoch <= newestEpoch - RETAINED_EPOCHS) this.lastSeq.delete(key);
    }
  }
}
