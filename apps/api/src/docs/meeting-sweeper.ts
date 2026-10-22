import {
  Injectable,
  Inject,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { withSweepLock } from '../infra/redis/sweep-lock.js';

/** How often the worker deletes meetings past their end (docs/ADR/0026 §2). */
const MEETING_SWEEP_MS = 60_000;
const LOCK_KEY = 'meetings:sweep:lock';

/** Row of app.expire_circle_meetings (migration 0032). */
interface GoneRow extends Record<string, unknown> {
  circle_id: string;
  members: string[];
}

/**
 * A meeting outside an event goes three hours after its time (its `ends_at`): once a minute the
 * worker deletes the ones past their end and tells each circle's members (`docs.changed`, no
 * polling). Runs in the worker.
 */
@Injectable()
export class MeetingSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('MeetingSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), MEETING_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Deletes the meetings past their end and tells their circles; returns how many. */
  async sweep(): Promise<number> {
    const result = await this.database.db.execute<GoneRow>(
      sql`SELECT * FROM app.expire_circle_meetings()`,
    );
    for (const row of result.rows) {
      await this.events.publish(row.members, { type: 'docs.changed', circleId: row.circle_id });
    }
    return result.rows.length;
  }

  /** A round still going is not started again here; the lock keeps other workers out. */
  private running = false;

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withSweepLock(this.redis, LOCK_KEY, MEETING_SWEEP_MS - 5_000, async () => {
        try {
          await this.sweep();
        } catch (error) {
          // The next round tries again; nothing about a meeting is logged.
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
