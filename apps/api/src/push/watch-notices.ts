import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { Notifier } from './notifier.js';

/** The hour the per-recipient limit looks back over, always ending now (a sliding window). */
export const WATCH_WINDOW_MS = 3_600_000;

/** The notices sent to one recipient, newest last: `watch-push:{userId}` → sorted set by time. */
export const watchNoticesKey = (userId: string) => `watch-push:${userId}`;

/**
 * One atomic step per recipient: forgets notices older than the window, refuses when the last one
 * is less than the minimum gap ago or the window already holds the limit, otherwise records this
 * one. Refusing records nothing, so a recipient at the limit is not pushed further out. Sliding,
 * not a fixed hour: however the notices fall, no hour ever holds more than the limit.
 */
const ALLOW = `
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local window = tonumber(ARGV[4])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local last = redis.call('ZRANGE', KEYS[1], -1, -1, 'WITHSCORES')
if #last > 0 and now - tonumber(last[2]) < gap then return 0 end
if redis.call('ZCARD', KEYS[1]) >= limit then return 0 end
redis.call('ZADD', KEYS[1], now, ARGV[1])
redis.call('PEXPIRE', KEYS[1], window)
return 1
`;

/**
 * The silent `watch` notice of background live mode (docs/ADR/0028 step 3): when someone looks at
 * a circle on the map, the members whose app is closed are woken once, so their phone can send
 * every second for a little while. The notice names the circle and nothing else (no watcher, no
 * device, no signature): it says no more than the live `watch` event the connected members get.
 *
 * The allowance is per recipient, whoever and however many watch: at most one notice every
 * `WATCH_PUSH_MIN_SECONDS` and `WATCH_PUSH_PER_HOUR` in any hour (a sliding window). It is also
 * the server's switch (`WATCH_PUSH`, off unless turned on).
 */
@Injectable()
export class WatchNotices {
  private readonly logger = new Logger('WatchNotices');
  private readonly on: boolean;
  private readonly minMs: number;
  private readonly perHour: number;

  constructor(
    @Inject(ENV) env: Env,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly notifier: Notifier,
  ) {
    this.on = env.WATCH_PUSH === 'on';
    this.minMs = env.WATCH_PUSH_MIN_SECONDS * 1_000;
    this.perHour = env.WATCH_PUSH_PER_HOUR;
  }

  /** Whether notices are sent at all (the switch is on and a push service is configured). */
  get enabled(): boolean {
    return this.on && this.notifier.enabled;
  }

  /**
   * Tells these members (the circle's other members whose app is not connected) that the circle
   * is watched; those within their allowance are queued, the rest are skipped. Never fails the
   * watch that caused it. Returns who was told. `now` is the time the allowance is judged at
   * (tests move it; the relay never passes it).
   */
  async tell(
    circleId: string,
    recipients: Iterable<string>,
    now: number = Date.now(),
  ): Promise<string[]> {
    if (!this.enabled) return [];
    const told: string[] = [];
    try {
      for (const userId of new Set(recipients)) {
        const allowed = await this.redis.eval(ALLOW, {
          keys: [watchNoticesKey(userId)],
          arguments: [
            String(now),
            String(this.minMs),
            String(this.perHour),
            String(WATCH_WINDOW_MS),
          ],
        });
        if (allowed !== 1) continue;
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
