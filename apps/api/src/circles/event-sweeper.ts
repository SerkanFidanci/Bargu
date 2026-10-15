import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { withSweepLock } from '../infra/redis/sweep-lock.js';
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

  /** A round still going is not started again here; the lock keeps other workers out. */
  private running = false;

  async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await withSweepLock(this.redis, LOCK_KEY, EVENT_SWEEP_MS - 5_000, async () => {
        try {
          await this.expiry.sweep();
        } catch (error) {
          // The next round tries again; nothing about the circles is logged.
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
