import { ConsoleLogger, type LogLevel } from '@nestjs/common';

import type { Env } from '../config/env.js';

const NEST_LEVELS: Record<Env['LOG_LEVEL'], LogLevel[]> = {
  silent: [],
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

/** Nest's own logger, aligned with the Fastify (pino) level; JSON lines in production. */
export function createNestLogger(env: Env): ConsoleLogger {
  const json = env.NODE_ENV === 'production';
  return new ConsoleLogger({ json, colors: !json, logLevels: NEST_LEVELS[env.LOG_LEVEL] });
}
