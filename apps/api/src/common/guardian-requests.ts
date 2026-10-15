import { HttpStatus } from '@nestjs/common';

import { ApiError } from './api-error.js';

/** How long someone waits after filling the waiting guardian requests (migration 0027). */
const FULL_RETRY_SECONDS = 3600;

/**
 * Too many guardian requests waiting (20 for a child, 5 for a newcomer; QA 5b/5c S-3): asked
 * again later, like any other limit. Anything else is passed on as it is.
 */
export function guardianRequestsFull(error: unknown): unknown {
  const message = [error, error instanceof Error ? error.cause : undefined]
    .map((value) => (value instanceof Error ? value.message : ''))
    .join(' ');
  return message.includes('guardian requests full')
    ? new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', FULL_RETRY_SECONDS)
    : error;
}
