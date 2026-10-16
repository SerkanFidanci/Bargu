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
import { PlanEvents } from './plan-events.js';

/** How often the worker looks for plans that ran out (docs/ADR/0024 §2). */
export const PLAN_SWEEP_MS = 60_000;
const LOCK_KEY = 'plans:sweep:lock';
/** Up to when the last round looked (Unix ms); the next one starts there, so none is missed. */
export const PLANS_SWEPT_KEY = 'plans:swept-until';
/** A first round (or one after a long stop) looks this far back. */
const FIRST_LOOK_MS = 10 * 60_000;

interface EndedRow extends Record<string, unknown> {
  user_id: string;
}

/**
 * Plans that ran out with time (a trial's 21 days, a cancelled plan's last day, the grace days after
 * a failed payment) change no row, so nothing announced them: once a minute the worker finds the
 * accounts whose Bargu+ ended since it last looked and tells their circles (PlanEvents). Runs in
 * the worker.
 */
@Injectable()
export class PlanSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('PlanSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly planEvents: PlanEvents,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), PLAN_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Tells the circles of every account whose plan ended up to `until`; returns how many. */
  async sweep(until = Date.now()): Promise<number> {
    const stored = Number(await this.redis.get(PLANS_SWEPT_KEY));
    const since = Number.isFinite(stored) && stored > 0 ? stored : until - FIRST_LOOK_MS;
    if (since >= until) return 0;
    const result = await this.database.db.execute<EndedRow>(
      sql`SELECT * FROM app.plans_ended_between(${new Date(since)}, ${new Date(until)})`,
    );
    for (const row of result.rows) await this.planEvents.changed(row.user_id);
    await this.redis.set(PLANS_SWEPT_KEY, String(until));
    return result.rows.length;
  }

  /** A round still going is not started again here; the lock keeps other workers out. */
  private running = false;

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withSweepLock(this.redis, LOCK_KEY, PLAN_SWEEP_MS - 5_000, async () => {
        try {
          await this.sweep();
        } catch (error) {
          // The next round looks from where this one started; nothing about plans is logged.
          this.logger.warn(`sweep failed: ${error instanceof Error ? error.name : 'unknown'}`);
        }
      });
    } catch (error) {
      this.logger.warn(`sweep lock failed: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally {
      this.running = false;
    }
  }
}
