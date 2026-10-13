import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';

import { schema } from '../../db/schema.js';
import { PG_POOL } from './tokens.js';

export type Db = NodePgDatabase<typeof schema>;
/** A transaction handle; every query in it runs under the row-level security of one user. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The only way application code reaches Postgres. Row-level security decides what a query can see:
 * `asUser` sets `app.user_id` for one transaction (SET LOCAL semantics, so a pooled connection
 * never carries it into the next request); without it every user-owned table appears empty.
 */
@Injectable()
export class DatabaseService {
  readonly db: Db;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.db = drizzle(pool, { schema });
  }

  asUser<T>(userId: string, work: (tx: Tx) => Promise<T>): Promise<T> {
    if (!UUID.test(userId)) throw new Error('asUser needs a canonical user id');
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.user_id', ${userId}, true)`);
      return work(tx);
    });
  }

  /** Pre-authentication work (no user yet): RLS hides every user row. */
  anonymous<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(work);
  }

  /** Account id for an email hash, through the one SECURITY DEFINER lookup. */
  async userIdForEmail(emailHmac: Uint8Array): Promise<string | null> {
    const result = await this.db.execute<{ id: string | null }>(
      sql`SELECT app.user_id_for_email(${Buffer.from(emailHmac)}) AS id`,
    );
    return result.rows[0]?.id ?? null;
  }

  /** A new time-ordered id from Postgres (uuidv7). */
  async newId(): Promise<string> {
    const result = await this.db.execute<{ id: string }>(sql`SELECT uuidv7()::text AS id`);
    const id = result.rows[0]?.id;
    if (id === undefined) throw new Error('uuidv7() returned no row');
    return id;
  }
}
