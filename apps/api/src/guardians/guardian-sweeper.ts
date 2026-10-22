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
import { withSweepLock } from '../infra/redis/sweep-lock.js';

/** How often the worker ends what is due (docs/ADR/0023 §4). */
const GUARDIAN_SWEEP_MS = 10 * 60_000;
const LOCK_KEY = 'guardians:sweep:lock';

/**
 * Ends guardian links whose time came: a child's request to end one, 7 days on; a code nobody took
 * and a yes nobody gave, a day on. Drops requests nobody answered in 7 days. Both sides hear every
 * one of them (an event; the child's plan too when what it says waits has changed). Runs in the
 * worker.
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
    const tools = await this.database.db.execute<{
      child_id: string;
      kind: string;
      guardian_ids: string[];
    }>(sql`SELECT * FROM app.expire_guardian_tools()`);
    // Both sides hear it: the child, and the parents whose open view still shows the request.
    const told = [
      ...result.rows.flatMap((row) =>
        row.guardian_id === null ? [row.child_id] : [row.child_id, row.guardian_id],
      ),
      ...tools.rows.flatMap((row) => [row.child_id, ...row.guardian_ids]),
    ];
    if (told.length > 0) await this.events.publish(told, { type: 'guardians.changed' });
    // What the child's plan says waits (a Bargu+ or a pack request, docs/ADR/0024 §5, 0025 §6)
    // changed when such a request ran out, or went with the link: their phones read it again.
    const waited = [
      ...result.rows.map((row) => row.child_id),
      ...tools.rows
        .filter((row) => row.kind === 'purchase' || row.kind === 'cosmetic')
        .map((row) => row.child_id),
    ];
    if (waited.length > 0) await this.events.publish(waited, { type: 'plan.changed' });
    return result.rows.length + tools.rows.length;
  }

  /** A round still going is not started again here; the lock keeps other workers out. */
  private running = false;

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withSweepLock(this.redis, LOCK_KEY, GUARDIAN_SWEEP_MS - 5_000, async () => {
        try {
          await this.sweep();
        } catch (error) {
          // The next round tries again; nothing about the links is logged.
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
