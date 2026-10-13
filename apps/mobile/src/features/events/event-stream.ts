import {
  type DeliveredEvent,
  deliveredEventSchema,
  resumeReplySchema,
  type ServerEvent,
} from '@bargu/schemas';

import type { KeyValueStore } from '../storage/vault';

/** The live connection as the stream needs it; socket.io in the app, a fake in tests. */
export interface Transport {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  /** Asks for missed events since `lastEventId` (null: none known, reload). */
  resume(lastEventId: string | null): Promise<unknown>;
}

export interface TransportHandlers {
  onConnect(): void;
  onEvent(payload: unknown): void;
  /** The server refused the handshake (its error code); no automatic retry follows. */
  onDenied(code: string): void;
  /** The server closed the connection (logout, device replaced); no automatic retry follows. */
  onServerDisconnect(): void;
}

export type TransportFactory = (handlers: TransportHandlers) => Transport;

export interface EventStreamDeps {
  transport: TransportFactory;
  store: KeyValueStore;
  /** Applies events in order (fetching what they point to). Throws when it could not. */
  apply(events: ServerEvent[]): Promise<void>;
  /** Reloads every circle (snapshot); throws when it could not. */
  reload(): Promise<void>;
  /** A refused handshake, for the session to react (e.g. DEVICE_REVOKED ends it). */
  denied(code: string): void;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
  now?: () => number;
}

/** Where the last handled event id is kept, so a restart resumes instead of reloading. */
export const LAST_EVENT_KEY = 'events:last';
/** Waits between attempts after a refusal or a failed catch-up, growing to the last one. */
export const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000, 60_000] as const;
/** A wake-up right after a connection attempt leaves that attempt alone (no needless restart). */
export const WAKE_GRACE_MS = 5_000;

/** Stream ids are "<ms>-<seq>" without leading zeros: longer is larger, then compare as text. */
export function compareEventIds(a: string, b: string): number {
  const [aMs = '', aSeq = ''] = a.split('-');
  const [bMs = '', bSeq = ''] = b.split('-');
  const compare = (x: string, y: string) =>
    x.length === y.length ? (x < y ? -1 : x > y ? 1 : 0) : x.length - y.length;
  return compare(aMs, bMs) || compare(aSeq, bSeq);
}

/**
 * The app's one live event channel (BARGU_PLAN §3.4, docs/ADR/0009). Keeps the phone's view in
 * step with the server without polling: on every connection it asks for what it missed (or, when
 * the gap is unknown, reloads once), then applies events as they arrive, strictly in order and
 * each exactly once. Events that arrive while the catch-up is still running wait for it.
 *
 * The first connection after `start()` always reloads: the cache is empty after a restart, and
 * anything a previous run failed to finish (a key upload that did not go out) is retried.
 */
export class EventStream {
  private transport: Transport | null = null;
  private running = false;
  private needsReload = true;
  private resuming = false;
  private waiting: DeliveredEvent[] = [];
  private queue: Promise<void> = Promise.resolve();
  private retryTimer: unknown = null;
  private failures = 0;
  private lastAttempt = Number.NEGATIVE_INFINITY;

  constructor(private readonly deps: EventStreamDeps) {}

  /** Connects (signed in, app in the foreground). */
  start(): void {
    this.running = true;
    this.transport ??= this.deps.transport({
      onConnect: () => {
        void this.catchUp();
      },
      onEvent: (payload) => {
        this.receive(payload);
      },
      onDenied: (code) => {
        this.deps.denied(code);
        this.retryLater(() => {
          this.connect();
        });
      },
      onServerDisconnect: () => {
        // The access token ran out (every few minutes): reconnect at once with a fresh one. If it
        // happens again straight away, back off; a revoked device then hears so in the handshake.
        if (this.failures === 0) {
          this.failures = 1;
          this.connect();
          return;
        }
        this.retryLater(() => {
          this.connect();
        });
      },
    });
    if (!this.transport.connected) this.connect();
  }

  /** Disconnects (background, sign-out). State is kept: the next start resumes. */
  stop(): void {
    this.running = false;
    this.clearRetry();
    this.transport?.disconnect();
  }

  /** Back to the foreground or the network: reconnect now instead of waiting for the backoff. */
  wake(): void {
    if (!this.running || this.transport === null || this.transport.connected) return;
    if (this.now() - this.lastAttempt < WAKE_GRACE_MS) return;
    this.clearRetry();
    this.transport.disconnect();
    this.connect();
  }

  private connect(): void {
    this.lastAttempt = this.now();
    this.transport?.connect();
  }

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  /** Sign-out: forget the connection and the stored position. */
  reset(): void {
    this.stop();
    this.transport = null;
    this.needsReload = true;
    this.waiting = [];
    this.failures = 0;
  }

  /** Runs one task after the previous ones (events and reloads never interleave). */
  private enqueue(task: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(task, task);
    return this.queue;
  }

  private receive(payload: unknown): void {
    const parsed = deliveredEventSchema.safeParse(payload);
    if (!parsed.success) return;
    if (this.resuming) {
      this.waiting.push(parsed.data);
      return;
    }
    void this.enqueue(() => this.handle([parsed.data]));
  }

  private async catchUp(): Promise<void> {
    this.failures = 0;
    this.resuming = true;
    this.waiting = [];
    let reply: { events: DeliveredEvent[]; snapshot: boolean; cursor: string | null };
    try {
      const parsed = resumeReplySchema.safeParse(await this.transport?.resume(this.lastId()));
      reply = parsed.success ? parsed.data : { events: [], snapshot: true, cursor: null };
    } catch {
      // No reply in time: reload rather than guess what was missed.
      reply = { events: [], snapshot: true, cursor: null };
    }
    const late = this.waiting;
    this.resuming = false;
    this.waiting = [];
    await this.enqueue(async () => {
      if (reply.snapshot || this.needsReload) {
        const reloaded = await this.reload();
        if (!reloaded) return;
        if (reply.cursor !== null) this.remember(reply.cursor);
      }
      await this.handle([...reply.events, ...late]);
    });
  }

  private async reload(): Promise<boolean> {
    try {
      await this.deps.reload();
      this.needsReload = false;
      this.failures = 0;
      return true;
    } catch {
      this.needsReload = true;
      this.retryLater(() => void this.enqueue(() => this.reload().then(() => undefined)));
      return false;
    }
  }

  /** Applies the new ones in id order; a failure means reload (events may have been half-done). */
  private async handle(events: DeliveredEvent[]): Promise<void> {
    const last = this.lastId();
    const fresh = events
      .filter((event) => last === null || compareEventIds(event.id, last) > 0)
      .sort((a, b) => compareEventIds(a.id, b.id))
      .filter((event, index, all) => index === 0 || all[index - 1]?.id !== event.id);
    if (fresh.length === 0) return;
    const newest = fresh[fresh.length - 1]?.id;
    try {
      await this.deps.apply(fresh.map((event) => event.event));
    } catch {
      // Not lost: the position still moves on, and a reload brings everything up to date.
      this.needsReload = true;
      this.retryLater(() => void this.enqueue(() => this.reload().then(() => undefined)));
    }
    if (newest !== undefined) this.remember(newest);
  }

  private lastId(): string | null {
    return this.deps.store.get(LAST_EVENT_KEY) ?? null;
  }

  private remember(id: string): void {
    const last = this.lastId();
    if (last === null || compareEventIds(id, last) > 0) this.deps.store.set(LAST_EVENT_KEY, id);
  }

  private retryLater(run: () => void): void {
    if (!this.running || this.retryTimer !== null) return;
    const delay = RETRY_DELAYS_MS[Math.min(this.failures, RETRY_DELAYS_MS.length - 1)] ?? 0;
    this.failures += 1;
    const setTimer = this.deps.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.retryTimer = setTimer(() => {
      this.retryTimer = null;
      if (this.running) run();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer === null) return;
    const clearTimer =
      this.deps.clearTimer ??
      ((timer: unknown) => {
        clearTimeout(timer as ReturnType<typeof setTimeout>);
      });
    clearTimer(this.retryTimer);
    this.retryTimer = null;
  }
}
