import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { QUEUES } from '../jobs/queues.js';

interface ExpiredRow extends Record<string, unknown> {
  expired_id: string;
  member_ids: string[];
}

interface PendingRow extends Record<string, unknown> {
  circle_id: string;
  member_ids: string[];
}

/** Circle ids inside Redis key names (rate limits and stores name the circle). */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
/** Keys looked at per step of the one pass over the keyspace. */
const SCAN_COUNT = 1000;

/**
 * The end of event circles (BARGU_PLAN Faz 8, docs/ADR/0017): when one ends, nothing of it may
 * stay on the server. The database deletes the circle with everything that cascades from it
 * (app.expire_event_circles); this clears the rest: the relay's latest envelopes and every Redis
 * key naming it (rate limits), the stored events that name it in its members' streams, and queued
 * notices about it, failed ones included. Its members' phones are told to reload their circle list
 * (an event that names no circle) and throw the circle's keys away; they also end it on their own
 * at the time. The database records each deleted circle until that clean-up went through
 * (app.event_cleanups), so one cut short (Redis down, a restart) is finished by the next sweep.
 */
@Injectable()
export class EventExpiry {
  private readonly logger = new Logger('EventExpiry');

  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly events: EventsService,
  ) {}

  /**
   * Deletes every event circle that has ended and clears what it left elsewhere, finishing earlier
   * clean-ups that were cut short; returns how many circles ended now. Throws when a clean-up failed
   * (it is tried again next time).
   */
  async sweep(): Promise<number> {
    let total = 0;
    for (;;) {
      const expired = await this.database.anonymous(async (tx) => {
        const result = await tx.execute<ExpiredRow>(
          sql`SELECT expired_id, member_ids FROM app.expire_event_circles()`,
        );
        return result.rows;
      });
      total += expired.length;
      if (expired.length < 100) break;
    }
    if (total > 0) this.logger.log(`ended ${String(total)} event circle(s)`);
    try {
      await this.clearPending();
    } finally {
      await this.warnIfStale();
    }
    return total;
  }

  /**
   * Clean-ups normally take seconds; one waiting for minutes keeps failing (Redis, the queue). Says
   * how many, never which (QA Faz 8, stale clean-up record).
   */
  private async warnIfStale(): Promise<void> {
    const stale = await this.database.anonymous(async (tx) => {
      const result = await tx.execute<{ stale: number }>(
        sql`SELECT app.stale_event_cleanups() AS stale`,
      );
      return result.rows[0]?.stale ?? 0;
    });
    if (stale > 0) {
      this.logger.warn(`${String(stale)} event clean-up(s) waiting for more than 5 minutes`);
    }
  }

  /** Clears every ended circle still waiting for it; the first failure is thrown at the end. */
  private async clearPending(): Promise<void> {
    let failure: Error | null = null;
    for (;;) {
      const pending = await this.database.anonymous(async (tx) => {
        const result = await tx.execute<PendingRow>(
          sql`SELECT circle_id, member_ids FROM app.pending_event_cleanups()`,
        );
        return result.rows;
      });
      if (pending.length === 0) break;
      // One pass over the keyspace for the whole page, not one per circle (QA Faz 8 O1).
      let keys: Map<string, string[]>;
      try {
        keys = await this.keysOf(pending.map((row) => row.circle_id));
      } catch (error) {
        failure ??= error instanceof Error ? error : new Error('clean-up failed');
        break;
      }
      let cleared = 0;
      for (const row of pending) {
        try {
          await this.clear(row.circle_id, row.member_ids, keys.get(row.circle_id) ?? []);
          await this.database.anonymous((tx) =>
            tx.execute(sql`SELECT app.finish_event_cleanup(${row.circle_id})`),
          );
          cleared += 1;
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error('clean-up failed');
        }
      }
      // A full page all cleared: there may be more; otherwise what failed waits for next time.
      if (pending.length < 100 || cleared < pending.length) break;
    }
    if (failure !== null) throw failure;
  }

  /**
   * The owner ends an event now: this circle alone is deleted and cleaned up at once; the backlog
   * of other ended events stays the worker's (QA Faz 8 O1).
   */
  async endNow(auth: AuthContext, circleId: string): Promise<void> {
    const members = await this.database.asUser(auth.userId, async (tx) => {
      const result = await tx.execute<{ members: string[] | null }>(
        sql`SELECT app.end_event_now(${circleId}) AS members`,
      );
      return result.rows[0]?.members ?? null;
    });
    if (members === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    try {
      const keys = await this.keysOf([circleId]);
      await this.clear(circleId, members, keys.get(circleId) ?? []);
      await this.database.anonymous((tx) =>
        tx.execute(sql`SELECT app.finish_event_cleanup(${circleId})`),
      );
    } catch (error) {
      // Ended and gone from the database; what is left elsewhere goes with the worker's next sweep.
      this.logger.warn(`clean-up deferred: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  /** Every Redis key naming one of these circles, found in a single pass over the keyspace. */
  private async keysOf(circleIds: readonly string[]): Promise<Map<string, string[]>> {
    const wanted = new Set(circleIds);
    const found = new Map<string, string[]>(circleIds.map((id) => [id, []]));
    const [only] = circleIds;
    const pattern = circleIds.length === 1 && only !== undefined ? `*${only}*` : '*';
    for await (const keys of this.redis.scanIterator({ MATCH: pattern, COUNT: SCAN_COUNT })) {
      for (const key of keys) {
        for (const id of key.match(UUID) ?? []) {
          if (wanted.has(id)) found.get(id)?.push(key);
        }
      }
    }
    return found;
  }

  /** Everything an ended circle left outside the database; safe to run again. */
  private async clear(
    circleId: string,
    members: readonly string[],
    named: readonly string[],
  ): Promise<void> {
    // The relay's stores and anything else keyed by the circle (rate limit counters).
    const keys = [`loc:${circleId}`, `status:${circleId}`, `profile:${circleId}`, ...named];
    await this.redis.del([...new Set(keys)]);
    await this.events.forgetCircle(members, circleId);
    // Notices about it still waiting in the queue, and failed ones kept in the dead letter queue
    // (their payload names the circle).
    await this.database.anonymous((tx) =>
      tx.execute(
        sql`DELETE FROM pgboss.job WHERE name IN (${QUEUES.push}, ${QUEUES.pushDead}) AND data->>'circleId' = ${circleId}`,
      ),
    );
    // "Reload your circles": names no circle (nothing about it is stored again).
    await this.events.publish(members, { type: 'circles.reload' });
  }
}
