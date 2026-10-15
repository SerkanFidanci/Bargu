import { randomUuid } from '@bargu/crypto';

import { REDIS, type RedisClient } from '../../../src/infra/redis/redis.client.js';
import type { TestApp } from './app.js';

/** Held by a test that ends events and sweeps them; other test files wait their turn. */
const LOCK_KEY = 'test:event-sweeps';
const LOCK_MS = 120_000;
const RETRY_MS = 50;
// Only the holder releases it.
const RELEASE = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;
/** A test that waits its turn may wait for others' sweeps too. */
export const SWEEP_TIMEOUT_MS = 120_000;

/**
 * A sweep handles every ended event in the shared test database, whichever file ended it: two
 * files sweeping at once take each other's events (a clean-up meant to fail is finished by the
 * other's sweep). Tests that end events and sweep them run their whole body here, one at a time
 * across every file (QA Faz 8 / 5c, flaky event-circles tests).
 */
export async function exclusively<T>(test: TestApp, work: () => Promise<T>): Promise<T> {
  const redis = test.app.get<RedisClient>(REDIS);
  const token = randomUuid();
  for (;;) {
    const locked = await redis.set(LOCK_KEY, token, {
      condition: 'NX',
      expiration: { type: 'PX', value: LOCK_MS },
    });
    if (locked === 'OK') break;
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
  }
  try {
    return await work();
  } finally {
    await redis.eval(RELEASE, { keys: [LOCK_KEY], arguments: [token] });
  }
}
