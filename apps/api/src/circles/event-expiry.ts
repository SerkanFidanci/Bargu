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

/**
 * The end of event circles (BARGU_PLAN Faz 8, docs/ADR/0017): when one ends, nothing of it may
 * stay on the server. The database deletes the circle with everything that cascades from it
 * (app.expire_event_circles); this clears the rest: the relay's latest envelopes and every Redis
 * key naming it (rate limits), the stored events that name it in its members' streams, and queued
 * notices about it. Its members' phones are told to reload their circle list (an event that names
 * no circle) and throw the circle's keys away; they also end it on their own at the time.
 */
@Injectable()
export class EventExpiry {
  private readonly logger = new Logger('EventExpiry');

  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly events: EventsService,
  ) {}

  /** Deletes every event circle that has ended; returns how many. */
  async sweep(): Promise<number> {
    let total = 0;
    for (;;) {
      const expired = await this.database.anonymous(async (tx) => {
        const result = await tx.execute<ExpiredRow>(
          sql`SELECT expired_id, member_ids FROM app.expire_event_circles()`,
        );
        return result.rows;
      });
      for (const row of expired) await this.clear(row.expired_id, row.member_ids);
      total += expired.length;
      if (expired.length < 100) break;
    }
    if (total > 0) this.logger.log(`ended ${String(total)} event circle(s)`);
    return total;
  }

  /** The owner ends an event now. */
  async endNow(auth: AuthContext, circleId: string): Promise<void> {
    const ended = await this.database.asUser(auth.userId, async (tx) => {
      const result = await tx.execute<{ ended: boolean }>(
        sql`SELECT app.end_event(${circleId}) AS ended`,
      );
      return result.rows[0]?.ended === true;
    });
    if (!ended) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    await this.sweep();
  }

  private async clear(circleId: string, members: readonly string[]): Promise<void> {
    // The relay's stores and anything else keyed by the circle (rate limit counters).
    const keys = [`loc:${circleId}`, `status:${circleId}`, `profile:${circleId}`];
    for await (const found of this.redis.scanIterator({ MATCH: `*${circleId}*`, COUNT: 500 })) {
      keys.push(...found);
    }
    await this.redis.del([...new Set(keys)]);
    await this.events.forgetCircle(members, circleId);
    // Notices about it still waiting in the queue (their payload names the circle).
    await this.database.anonymous((tx) =>
      tx.execute(
        sql`DELETE FROM pgboss.job WHERE name = ${QUEUES.push} AND data->>'circleId' = ${circleId}`,
      ),
    );
    // "Reload your circles": names no circle (nothing about it is stored again).
    await this.events.publish(members, { type: 'circles.reload' });
  }
}
