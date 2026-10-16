import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { webKeysOf } from '../auth/web-account.service.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { QUEUES } from '../jobs/queues.js';

/** Accounts handled per round; a full page means there may be more. */
const PAGE = 100;
/** app.expire_security_events() deletes at most this many per call. */
const EXPIRE_BATCH = 5000;

/**
 * The second half of deleting an account (docs/ADR/0022): the user row goes, and with it, by
 * cascade, everything tied to it in the database; then whatever outside it still names the
 * account (Redis keys such as rate limits and its event stream, notices waiting in the queue).
 * Each account is recorded in app.account_deletions until all of it is done, so a round cut short
 * is finished by the next one; every step can run again. The circles that held documents it wrote
 * (a meeting it started, its polls and votes) hear that they changed (QA 21 B-3).
 */
@Injectable()
export class AccountPurge {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly events: EventsService,
  ) {}

  /** Purges every account waiting for it; the first failure is thrown at the end. */
  async sweep(): Promise<number> {
    let purged = 0;
    let failure: Error | null = null;
    for (;;) {
      const pending = await this.database.anonymous(async (tx) => {
        const result = await tx.execute<{ id: string }>(
          sql`SELECT app.pending_account_deletions(${PAGE}) AS id`,
        );
        return result.rows.map((row) => row.id);
      });
      let done = 0;
      for (const userId of pending) {
        try {
          const touched = await this.database.anonymous(async (tx) => {
            const result = await tx.execute<{ circle_id: string; members: string[] }>(
              sql`SELECT * FROM app.doc_circles_of_deleted(${userId})`,
            );
            await tx.execute(sql`SELECT app.purge_account(${userId})`);
            return result.rows;
          });
          for (const { circle_id: circleId, members } of touched) {
            await this.events.publish(members, { type: 'docs.changed', circleId });
          }
          await this.clearOutside(userId);
          await this.database.anonymous((tx) =>
            tx.execute(sql`SELECT app.finish_account_deletion(${userId})`),
          );
          done += 1;
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error('purge failed');
        }
      }
      purged += done;
      if (pending.length < PAGE || done < pending.length) break;
    }
    if (failure !== null) throw failure;
    return purged;
  }

  /**
   * Security events older than they are shown (90 days, docs/ADR/0021) go, everyone's; returns how
   * many (QA Faz 9 slice 4, K5).
   */
  async expireSecurityEvents(): Promise<number> {
    let total = 0;
    for (;;) {
      const result = await this.database.db.execute<{ removed: number }>(
        sql`SELECT app.expire_security_events() AS removed`,
      );
      const removed = result.rows[0]?.removed ?? 0;
      total += removed;
      if (removed < EXPIRE_BATCH) return total;
    }
  }

  /** Everything outside the database that names the account; safe to run again. */
  private async clearOutside(userId: string): Promise<void> {
    // Pending web codes and sessions carry the account inside, not in their names.
    const keys: string[] = await this.redis.sMembers(webKeysOf(userId));
    for await (const found of this.redis.scanIterator({ MATCH: `*${userId}*`, COUNT: 500 })) {
      keys.push(...found);
    }
    if (keys.length > 0) await this.redis.del([...new Set(keys)]);
    await this.database.anonymous((tx) =>
      tx.execute(
        sql`DELETE FROM pgboss.job WHERE name IN (${QUEUES.push}, ${QUEUES.pushDead}) AND data->>'userId' = ${userId}`,
      ),
    );
  }
}
