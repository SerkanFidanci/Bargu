import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { QUEUES } from '../jobs/queues.js';

/** Accounts handled per round; a full page means there may be more. */
const PAGE = 100;

/**
 * The second half of deleting an account (docs/ADR/0022): the user row goes, and with it, by
 * cascade, everything tied to it in the database; then whatever outside it still names the
 * account (Redis keys such as rate limits and its event stream, notices waiting in the queue).
 * Each account is recorded in app.account_deletions until all of it is done, so a round cut short
 * is finished by the next one; every step can run again.
 */
@Injectable()
export class AccountPurge {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
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
          await this.database.anonymous((tx) =>
            tx.execute(sql`SELECT app.purge_account(${userId})`),
          );
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

  /** Everything outside the database that names the account; safe to run again. */
  private async clearOutside(userId: string): Promise<void> {
    const keys: string[] = [];
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
