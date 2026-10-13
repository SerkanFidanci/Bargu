import { Logger } from '@nestjs/common';
import { createClient } from 'redis';

import type { Env } from '../../config/env.js';

export const REDIS = Symbol('REDIS');

const MAX_RECONNECT_DELAY_MS = 3_000;

// Return type is inferred on purpose: it carries the concrete module/RESP generics of the client.
export function createRedisClient(env: Env) {
  const logger = new Logger('Redis');
  const client = createClient({
    url: env.REDIS_URL,
    // Fail commands immediately while disconnected instead of queueing them: realtime data must
    // not be delivered late, and callers surface the error.
    disableOfflineQueue: true,
    socket: {
      connectTimeout: 5_000,
      reconnectStrategy: (retries) => Math.min(100 * 2 ** retries, MAX_RECONNECT_DELAY_MS),
    },
  });
  client.on('error', (error: Error) => {
    logger.error(`Connection error: ${error.message}`);
  });
  // Connect in the background: the API starts (and reports not-ready) while Redis is unavailable
  // and recovers on its own once Redis comes back.
  client.connect().catch((error: unknown) => {
    logger.error(
      `Initial connection failed: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  });
  return client;
}

export type RedisClient = ReturnType<typeof createRedisClient>;
