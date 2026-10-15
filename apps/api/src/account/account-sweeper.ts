import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { AccountPurge } from './account-purge.js';

/**
 * How often the worker finishes deleting accounts. The API purges right after a deletion; this
 * catches what that could not finish (docs/ADR/0022: at most 7 days, in practice minutes). The
 * same round deletes security events past their 90 days.
 */
export const ACCOUNT_SWEEP_MS = 5 * 60_000;
const LOCK_KEY = 'accounts:sweep:lock';

@Injectable()
export class AccountSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('AccountSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly purge: AccountPurge,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), ACCOUNT_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    const locked = await this.redis.set(LOCK_KEY, '1', {
      condition: 'NX',
      expiration: { type: 'PX', value: ACCOUNT_SWEEP_MS - 5_000 },
    });
    if (locked !== 'OK') return;
    try {
      await this.attempt('sweep', () => this.purge.sweep());
      await this.attempt('security events', () => this.purge.expireSecurityEvents());
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }

  /** The next round tries again; nothing about the accounts is logged. */
  private async attempt(what: string, step: () => Promise<number>): Promise<void> {
    try {
      await step();
    } catch (error) {
      this.logger.warn(`${what} failed: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}
