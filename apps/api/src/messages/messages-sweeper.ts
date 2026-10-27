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

/** How often the worker deletes items and files past their 24 hours (docs/ADR/0035 §7). */
const CHAT_SWEEP_MS = 5 * 60_000;
/** One worker sweeps per round, even if several run. */
const LOCK_KEY = 'chat:sweep:lock';
/** app.expire_chat() deletes at most this many of each kind per call. */
const BATCH = 5000;

/**
 * Deletes items and photo files of messages and moments once their 24 hours are over, and files no
 * item shares any more (taken back, an event that ended). Reads never show an expired item, so a
 * late round only frees space. Runs in the worker.
 */
@Injectable()
export class MessagesSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MessagesSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), CHAT_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Deletes everything past its 24 hours; returns how many rows went (the larger kind per call). */
  async sweep(): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.database.db.execute<{ removed: number }>(
        sql`SELECT app.expire_chat() AS removed`,
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
      await withSweepLock(this.redis, LOCK_KEY, CHAT_SWEEP_MS - 5_000, async () => {
        try {
          await this.sweep();
        } catch (error) {
          // The next round tries again; nothing about the items is logged.
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
