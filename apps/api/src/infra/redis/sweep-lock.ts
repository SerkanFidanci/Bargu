import { randomUuid } from '@bargu/crypto';

import type { RedisClient } from './redis.client.js';

// Deletes the lock only while it is still ours: a sweep that outlived its lock must not delete the
// lock of the sweep that took over (QA Faz 8 O1).
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

/**
 * One sweep at a time across every worker: runs `work` while holding `key` (for at most `ttlMs`),
 * or not at all when another holds it. The lock carries a random owner token and is released only
 * by its owner. Returns whether it ran.
 */
export async function withSweepLock(
  redis: RedisClient,
  key: string,
  ttlMs: number,
  work: () => Promise<void>,
): Promise<boolean> {
  const token = randomUuid();
  const locked = await redis.set(key, token, {
    condition: 'NX',
    expiration: { type: 'PX', value: ttlMs },
  });
  if (locked !== 'OK') return false;
  try {
    await work();
  } finally {
    await redis.eval(RELEASE, { keys: [key], arguments: [token] });
  }
  return true;
}
