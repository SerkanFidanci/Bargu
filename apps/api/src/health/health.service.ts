import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';

import { PG_POOL } from '../infra/database/database.module.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.module.js';

type DependencyStatus = 'up' | 'down';

export interface ReadinessReport {
  status: 'ok' | 'unavailable';
  checks: { postgres: DependencyStatus; redis: DependencyStatus };
}

const CHECK_TIMEOUT_MS = 1_000;

async function probe(check: () => Promise<unknown>): Promise<DependencyStatus> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('timeout'));
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([check(), timeout]);
    return 'up';
  } catch {
    return 'down';
  } finally {
    clearTimeout(timer);
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  async readiness(): Promise<ReadinessReport> {
    const [postgres, redis] = await Promise.all([
      probe(() => this.pool.query('SELECT 1')),
      probe(async () => {
        if (!this.redis.isReady) throw new Error('not connected');
        await this.redis.ping();
      }),
    ]);
    const status = postgres === 'up' && redis === 'up' ? 'ok' : 'unavailable';
    return { status, checks: { postgres, redis } };
  }
}
