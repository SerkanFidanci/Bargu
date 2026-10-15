import { Inject, Injectable } from '@nestjs/common';

import { REDIS, type RedisClient } from './redis.client.js';

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the current window ends. */
  retryAfter: number;
}

// INCR and the first EXPIRE in one step, so a crash can never leave a counter without a TTL.
const FIXED_WINDOW = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return { count, ttl }
`;

const REFUND = `
if tonumber(redis.call('GET', KEYS[1]) or '0') > 0 then return redis.call('DECR', KEYS[1]) end
return 0
`;

/**
 * Fixed-window counters in Redis, shared by every API instance. Keys carry no personal data in
 * clear: callers pass hashes (email HMAC, hashed IP).
 */
@Injectable()
export class RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const [count, ttl] = (await this.redis.eval(FIXED_WINDOW, {
      keys: [`rl:${key}`],
      arguments: [String(windowSeconds)],
    })) as [number, number];
    return { allowed: count <= limit, retryAfter: Math.max(1, ttl) };
  }

  /** Current count without counting this call (e.g. "is this email locked?"). */
  async peek(key: string): Promise<number> {
    return Number((await this.redis.get(`rl:${key}`)) ?? 0);
  }

  /** Gives back one counted hit (a counted action that rolled back); never below zero. */
  async refund(key: string): Promise<void> {
    await this.redis.eval(REFUND, { keys: [`rl:${key}`] });
  }

  async reset(key: string): Promise<void> {
    await this.redis.del(`rl:${key}`);
  }
}
