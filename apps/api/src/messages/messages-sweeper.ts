import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { randomUuid } from '@bargu/crypto';
import { sql } from 'drizzle-orm';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { withSweepLock } from '../infra/redis/sweep-lock.js';
import { EmailJobs } from '../jobs/email-jobs.js';

/** How often the worker deletes items and files past their 24 hours (docs/ADR/0035 §7). */
const CHAT_SWEEP_MS = 5 * 60_000;
/** One worker sweeps per round, even if several run. */
const LOCK_KEY = 'chat:sweep:lock';
/** app.expire_chat() deletes at most this many of each kind per call. */
const BATCH = 5000;
/** The photos' space this full warns the operator, at most once a day (docs/ADR/0035 §10). */
export const MEDIA_ALARM_SHARE = 0.8;
const MEDIA_ALARM_KEY = 'chat:media:alarm';
const MEDIA_ALARM_SECONDS = 24 * 3600;

/**
 * Deletes items and photo files of messages and moments once their 24 hours are over, and files no
 * item shares any more (taken back, an event that ended). Reads never show an expired item, so a
 * late round only frees space. Also deletes reports past their 90 days, and tells the operator
 * once a day while the photos fill 80% of their space. Runs in the worker.
 */
@Injectable()
export class MessagesSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MessagesSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly email: EmailJobs,
    @Inject(ENV) private readonly env: Env,
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
      if (removed < BATCH) break;
    }
    await this.database.db.execute(sql`SELECT app.expire_reports()`);
    await this.watchSpace();
    return total;
  }

  /**
   * How full the photos' space is; past 80%, the operator hears of it once a day (email, or the
   * log without OPS_EMAIL). Returns the share, for the tests.
   */
  async watchSpace(): Promise<number> {
    const [row] = (
      await this.database.db.execute<{ bytes: string }>(sql`SELECT app.media_bytes() AS bytes`)
    ).rows;
    const share = Number(row?.bytes ?? 0) / this.env.MEDIA_MAX_BYTES;
    if (share < MEDIA_ALARM_SHARE) return share;
    // Once a day, whichever worker sees it first.
    const first = await this.redis.set(MEDIA_ALARM_KEY, '1', {
      NX: true,
      EX: MEDIA_ALARM_SECONDS,
    });
    if (first === null) return share;
    const percent = String(Math.floor(share * 100));
    if (this.env.OPS_EMAIL === undefined) {
      this.logger.warn(`photos fill ${percent}% of MEDIA_MAX_BYTES`);
      return share;
    }
    await this.email.enqueueOps({
      to: this.env.OPS_EMAIL,
      topic: 'media',
      detail: percent,
      id: randomUuid(),
    });
    return share;
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
