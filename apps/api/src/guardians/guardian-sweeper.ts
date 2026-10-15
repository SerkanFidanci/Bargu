import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';

/** How often the worker ends what is due (docs/ADR/0023 §4). */
export const GUARDIAN_SWEEP_MS = 10 * 60_000;
const LOCK_KEY = 'guardians:sweep:lock';

/**
 * Ends guardian links whose time came: a child's request to end one, 7 days on; a code nobody took
 * and a yes nobody gave, a day on. Both sides hear it. Runs in the worker.
 */
@Injectable()
export class GuardianSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('GuardianSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), GUARDIAN_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Ends what is due; returns how many links went. */
  async sweep(): Promise<number> {
    const result = await this.database.db.execute<{
      child_id: string;
      guardian_id: string | null;
    }>(sql`SELECT * FROM app.expire_guardian_links()`);
    // Requests nobody answered in 7 days, and minutes older than 7 days (docs/ADR/0023 §5).
    const tools = await this.database.db.execute<{ child_id: string }>(
      sql`SELECT * FROM app.expire_guardian_tools()`,
    );
    const told = [
      ...result.rows.flatMap((row) =>
        row.guardian_id === null ? [row.child_id] : [row.child_id, row.guardian_id],
      ),
      ...tools.rows.map((row) => row.child_id),
    ];
    if (told.length > 0) await this.events.publish(told, { type: 'guardians.changed' });
    return result.rows.length + tools.rows.length;
  }

  async run(): Promise<void> {
    const locked = await this.redis.set(LOCK_KEY, '1', {
      condition: 'NX',
      expiration: { type: 'PX', value: GUARDIAN_SWEEP_MS - 5_000 },
    });
    if (locked !== 'OK') return;
    try {
      await this.sweep();
    } catch (error) {
      // The next round tries again; nothing about the links is logged.
      this.logger.warn(`sweep failed: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }
}
