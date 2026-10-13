import { PassThrough } from 'node:stream';

import { Body, Controller, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { parseEnv } from '../src/config/env.js';
import { configureApp } from '../src/http/configure-app.js';
import { BODY_LIMIT_BYTES, createHttpAdapter } from '../src/http/http-adapter.js';
import { PG_POOL } from '../src/infra/database/database.module.js';
import { REDIS, type RedisClient } from '../src/infra/redis/redis.module.js';

const env = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1',
});

/** Test-only route: the app has no mutation endpoints yet, but hardening must cover them. */
@Controller('echo')
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

interface Dependencies {
  postgresUp: boolean;
  redisReady: boolean;
}

function fakePool(deps: Dependencies): Pool {
  return {
    query: () =>
      deps.postgresUp ? Promise.resolve({ rows: [] }) : Promise.reject(new Error('down')),
    end: () => Promise.resolve(),
  } as unknown as Pool;
}

function fakeRedis(deps: Dependencies): RedisClient {
  return {
    get isReady() {
      return deps.redisReady;
    },
    isOpen: false,
    ping: () => Promise.resolve('PONG'),
    destroy: () => undefined,
  } as unknown as RedisClient;
}

describe('API (e2e)', () => {
  let app: NestFastifyApplication;
  let deps: Dependencies;
  let logs: string;

  beforeEach(async () => {
    deps = { postgresUp: true, redisReady: true };
    logs = '';
    const logStream = new PassThrough();
    logStream.on('data', (chunk: Buffer) => {
      logs += chunk.toString('utf8');
    });

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(env)],
      controllers: [EchoController],
    })
      .overrideProvider(PG_POOL)
      .useValue(fakePool(deps))
      .overrideProvider(REDIS)
      .useValue(fakeRedis(deps))
      .compile();

    app = configureApp(
      moduleRef.createNestApplication<NestFastifyApplication>(
        createHttpAdapter(env, { logStream }),
        {
          logger: false,
        },
      ),
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterEach(async () => {
    await app.close();
  });

  describe('GET /health/live', () => {
    it('responds 200 with hardened headers and a request id', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/live' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ status: 'ok' });
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['strict-transport-security']).toBeDefined();
      expect(response.headers['content-security-policy']).toBeDefined();
      expect(response.headers['x-powered-by']).toBeUndefined();
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(response.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('ignores a client supplied request id', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/health/live',
        headers: { 'x-request-id': 'attacker-controlled' },
      });
      expect(response.headers['x-request-id']).not.toBe('attacker-controlled');
    });
  });

  describe('GET /health/ready', () => {
    it('responds 200 when every dependency is up', async () => {
      const response = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        checks: { postgres: 'up', redis: 'up' },
      });
    });

    it.each([
      ['postgres', { postgresUp: false, redisReady: true }],
      ['redis', { postgresUp: true, redisReady: false }],
    ])('responds 503 when %s is down', async (name, state) => {
      Object.assign(deps, state);
      const response = await app.inject({ method: 'GET', url: '/health/ready' });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ status: 'unavailable' });
      expect(JSON.stringify(response.json())).toContain(`"${name}":"down"`);
    });
  });

  describe('request hardening', () => {
    it('accepts native client requests (no browser fetch metadata)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'content-type': 'application/json' },
        payload: '{"ok":true}',
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toEqual({ ok: true });
    });

    it('rejects cross-site browser requests', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
        payload: '{}',
      });
      expect(response.statusCode).toBe(403);
    });

    it('rejects bodies above the limit', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/echo',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ blob: 'x'.repeat(BODY_LIMIT_BYTES) }),
      });
      expect(response.statusCode).toBe(413);
    });
  });

  describe('logging', () => {
    it('logs the route pattern, never the raw URL or client IP', async () => {
      await app.inject({ method: 'GET', url: '/health/live?token=leaked-secret' });

      expect(logs).toContain('"route":"/health/live"');
      expect(logs).not.toContain('leaked-secret');
      expect(logs).not.toContain('remoteAddress');
    });

    it('redacts sensitive fields', () => {
      app
        .getHttpAdapter()
        .getInstance()
        .log.info(
          {
            email: 'someone@example.com',
            token: 'tok-123',
            payload: { lat: 41.0082, lng: 28.9784, pushToken: 'push-abc' },
          },
          'structured',
        );

      for (const secret of ['someone@example.com', 'tok-123', '41.0082', '28.9784', 'push-abc']) {
        expect(logs).not.toContain(secret);
      }
      expect(logs).toContain('[REDACTED]');
    });
  });
});
