import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { withSweepLock } from '../infra/redis/sweep-lock.js';

/** How often the worker deletes history older than two weeks. */
const HISTORY_SWEEP_MS = 10 * 60_000;
/** One worker sweeps per round, even if several run. */
const LOCK_KEY = 'history:sweep:lock';
/** app.expire_history() deletes at most this many per call. */
const BATCH = 5000;

/** Deletes pieces of location history older than two weeks (docs/ADR/0019). Runs in the worker. */
@Injectable()
export class HistorySweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('HistorySweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), HISTORY_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Deletes everything past its two weeks; returns how many pieces went. */
  async sweep(): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.database.db.execute<{ removed: number }>(
        sql`SELECT app.expire_history() AS removed`,
      );
      const removed = result.rows[0]?.removed ?? 0;
      total += removed;
      if (removed < BATCH) return total;
    }
  }

  /** A round still going is not started again here; the lock keeps other workers out. */
  private running = false;

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withSweepLock(this.redis, LOCK_KEY, HISTORY_SWEEP_MS - 5_000, async () => {
        try {
          await this.sweep();
        } catch (error) {
          // The next round tries again; nothing about the pieces is logged.
          this.logger.warn(`sweep failed: ${error instanceof Error ? error.name : 'unknown'}`);
        }
      });
    } catch (error) {
      // Redis unreachable: the next round tries again.
      this.logger.warn(`sweep lock failed: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }
}
