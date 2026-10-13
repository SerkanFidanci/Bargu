import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { DatabaseService } from './database.service.js';
import { PG_POOL } from './tokens.js';

export { PG_POOL };

function createPool(env: Env): Pool {
  const logger = new Logger('Postgres');
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    application_name: 'bargu-api',
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 10_000,
    query_timeout: 10_000,
  });
  // An idle client losing its connection emits 'error' on the pool; unhandled, it crashes the
  // process. The pool replaces the client on its own, so logging is enough.
  pool.on('error', (error) => {
    logger.error(`Idle client error: ${error.message}`);
  });
  return pool;
}

@Global()
@Module({
  providers: [{ provide: PG_POOL, inject: [ENV], useFactory: createPool }, DatabaseService],
  exports: [PG_POOL, DatabaseService],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
