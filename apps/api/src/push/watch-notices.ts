import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { Notifier } from './notifier.js';

/**
 * The silent `watch` notice of background live mode (docs/ADR/0028 step 3): when someone looks at
 * a circle on the map, the members whose app is closed are woken once, so their phone can send
 * every second for a little while. The notice names the circle and nothing else (no watcher, no
 * device, no signature): it says no more than the live `watch` event the connected members get.
 *
 * The allowance is per recipient, whoever and however many watch: at most one notice every
 * `WATCH_PUSH_MIN_SECONDS` and `WATCH_PUSH_PER_HOUR` an hour (fixed windows). It is also the
 * server's switch (`WATCH_PUSH`, off unless turned on).
 */
@Injectable()
export class WatchNotices {
  private readonly logger = new Logger('WatchNotices');
  private readonly on: boolean;
  private readonly minSeconds: number;
  private readonly perHour: number;

  constructor(
    @Inject(ENV) env: Env,
    private readonly limiter: RateLimiter,
    private readonly notifier: Notifier,
  ) {
    this.on = env.WATCH_PUSH === 'on';
    this.minSeconds = env.WATCH_PUSH_MIN_SECONDS;
    this.perHour = env.WATCH_PUSH_PER_HOUR;
  }

  /** Whether notices are sent at all (the switch is on and a push service is configured). */
  get enabled(): boolean {
    return this.on && this.notifier.enabled;
  }

  /**
   * Tells these members (the circle's other members whose app is not connected) that the circle
   * is watched; those within their allowance are queued, the rest are skipped. Never fails the
   * watch that caused it. Returns who was told.
   */
  async tell(circleId: string, recipients: Iterable<string>): Promise<string[]> {
    if (!this.enabled) return [];
    const told: string[] = [];
    try {
      for (const userId of new Set(recipients)) {
        const gap = await this.limiter.hit(`watch-push:gap:${userId}`, 1, this.minSeconds);
        if (!gap.allowed) continue;
        const hour = await this.limiter.hit(`watch-push:hour:${userId}`, this.perHour, 3_600);
        if (!hour.allowed) continue;
        await this.notifier.notifyWatch(userId, circleId);
        told.push(userId);
      }
    } catch (error) {
      // The watch itself went through; a missed notice only means a slower friend. No ids here.
      this.logger.warn(`watch notice failed: ${error instanceof Error ? error.name : 'unknown'}`);
    }
    return told;
  }
}
