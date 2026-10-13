import { FastifyAdapter } from '@nestjs/platform-fastify';

import type { Env } from '../config/env.js';

const SENSITIVE_KEYS = [
  'token',
  'accessToken',
  'refreshToken',
  'pushToken',
  'password',
  'otp',
  'email',
  'lat',
  'lng',
  'latitude',
  'longitude',
] as const;

/**
 * Log redaction (CLAUDE.md: location, tokens, emails and push tokens are never logged).
 * Request bodies are not logged at all; these paths are a safety net for structured log calls.
 */
export const REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-bargu-sig"]',
  'res.headers["set-cookie"]',
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
];

interface LoggedRequest {
  id: string;
  method: string;
  routeOptions?: { url?: string | undefined };
}

interface LoggedReply {
  statusCode: number;
}

export interface HttpAdapterOptions {
  /** Log destination override, used by tests. */
  logStream?: NodeJS.WritableStream;
}

export const BODY_LIMIT_BYTES = 64 * 1024;

export function createHttpAdapter(env: Env, options: HttpAdapterOptions = {}): FastifyAdapter {
  return new FastifyAdapter({
    logger: {
      level: env.LOG_LEVEL,
      redact: { paths: [...REDACT_PATHS], censor: '[REDACTED]' },
      serializers: {
        // Log the route pattern (`/invites/:token`), never the raw URL: paths and query strings
        // can carry tokens. Client IPs are personal data and are not logged either.
        req: (request: LoggedRequest) => ({
          id: request.id,
          method: request.method,
          route: request.routeOptions?.url ?? null,
        }),
        res: (reply: LoggedReply) => ({ statusCode: reply.statusCode }),
      },
      ...(options.logStream ? { stream: options.logStream } : {}),
    },
    genReqId: () => globalThis.crypto.randomUUID(),
    trustProxy: env.TRUST_PROXY.length > 0 ? env.TRUST_PROXY : false,
    bodyLimit: BODY_LIMIT_BYTES,
    connectionTimeout: 10_000,
    requestTimeout: 15_000,
  });
}
