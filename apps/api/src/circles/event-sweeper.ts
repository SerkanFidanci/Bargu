import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { EventExpiry } from './event-expiry.js';

/** How often the worker looks for event circles that have ended (phones end them on time). */
export const EVENT_SWEEP_MS = 30_000;
/** One worker sweeps per round, even if several run. */
const LOCK_KEY = 'events:sweep:lock';

/** Deletes ended event circles every half minute (docs/ADR/0017). Runs in the worker. */
@Injectable()
export class EventSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('EventSweeper');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly expiry: EventExpiry,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  onApplicationBootstrap(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), EVENT_SWEEP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    const locked = await this.redis.set(LOCK_KEY, '1', {
      condition: 'NX',
      expiration: { type: 'PX', value: EVENT_SWEEP_MS - 5_000 },
    });
    if (locked !== 'OK') return;
    try {
      await this.expiry.sweep();
    } catch (error) {
      // The next round tries again; nothing about the circles is logged.
      this.logger.warn(`sweep failed: ${error instanceof Error ? error.name : 'unknown'}`);
    } finally {
      await this.redis.del(LOCK_KEY);
    }
  }
}
