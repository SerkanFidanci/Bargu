import { PassThrough } from 'node:stream';

import { Body, Controller, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module.js';
import { Public, Unsigned } from '../src/auth/request-context.js';
import { parseEnv } from '../src/config/env.js';
import { configureApp } from '../src/http/configure-app.js';
import { BODY_LIMIT_BYTES, createHttpAdapter } from '../src/http/http-adapter.js';
import { PG_POOL } from '../src/infra/database/database.module.js';
import { REDIS, type RedisClient } from '../src/infra/redis/redis.module.js';
import { JOB_QUEUE } from '../src/jobs/jobs.module.js';

const env = parseEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'info',
  DATABASE_URL: 'postgres://test:test@127.0.0.1:1/test',
  REDIS_URL: 'redis://127.0.0.1:1',
  JWT_SIGNING_KEY: 'a'.repeat(43),
  OTP_KEY: 'b'.repeat(43),
  EMAIL_LOOKUP_KEY: 'c'.repeat(43),
  JOB_PAYLOAD_KEY: 'd'.repeat(43),
  SMTP_URL: 'smtp://127.0.0.1:1',
  MAIL_FROM: 'Bargu <no-reply@bargu.test>',
  WEBAUTHN_RP_ID: 'bargu.test',
  WEBAUTHN_ORIGINS: 'https://bargu.test',
  ANDROID_CERT_SHA256: 'ab'.repeat(32),
  IOS_APP_ID: 'ABCDE12345.app.bargu',
});

/** The queue needs Postgres; these tests cover HTTP behaviour only. */
const fakeQueue = { start: () => Promise.resolve(), stop: () => Promise.resolve() };

/** Test-only public route: hardening must cover mutation endpoints that need no login. */
@Controller('echo')
@Public()
@Unsigned()
class EchoController {
  @Post()
  echo(@Body() body: unknown): unknown {
    return body;
  }
}

/** A public mutating route that forgot its signature policy: must fail closed. */
@Controller('forgotten')
@Public()
class ForgottenPolicyController {
  @Post()
  change(): string {
    return 'changed';
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
      controllers: [EchoController, ForgottenPolicyController],
    })
      .overrideProvider(PG_POOL)
      .useValue(fakePool(deps))
      .overrideProvider(REDIS)
      .useValue(fakeRedis(deps))
      .overrideProvider(JOB_QUEUE)
      .useValue(fakeQueue)
      .compile();

    app = configureApp(
      moduleRef.createNestApplication<NestFastifyApplication>(
        createHttpAdapter(env, { logStream }),
        { logger: false, rawBody: true },
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

  describe('errors', () => {
    it('answer with a stable code and nothing else', async () => {
      const missing = await app.inject({ method: 'GET', url: '/nope' });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ statusCode: 404, error: 'NOT_FOUND', code: 'NOT_FOUND' });

      const invalid = await app.inject({
        method: 'POST',
        url: '/v1/auth/otp/request',
        headers: { 'content-type': 'application/json' },
        payload: '{"email":"not-an-email","locale":"tr"}',
      });
      expect(invalid.statusCode).toBe(400);
      expect(invalid.json()).toEqual({
        statusCode: 400,
        error: 'BAD_REQUEST',
        code: 'VALIDATION_FAILED',
      });
    });

    it('refuses a public mutating route that declares no signature policy', async () => {
      const response = await app.inject({ method: 'POST', url: '/forgotten' });
      expect(response.statusCode).toBe(500);
      expect(response.json()).toMatchObject({ code: 'INTERNAL' });
      expect(response.body).not.toContain('signature policy');
    });
  });

  describe('well-known association files', () => {
    it('vouch for the Android app (passkeys and links)', async () => {
      const response = await app.inject({ method: 'GET', url: '/.well-known/assetlinks.json' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        {
          relation: [
            'delegate_permission/common.handle_all_urls',
            'delegate_permission/common.get_login_creds',
          ],
          target: {
            namespace: 'android_app',
            package_name: 'app.bargu',
            sha256_cert_fingerprints: [Array(32).fill('AB').join(':')],
          },
        },
      ]);
    });

    it('vouch for the iOS app', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/.well-known/apple-app-site-association',
      });
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json()).toMatchObject({
        webcredentials: { apps: ['ABCDE12345.app.bargu'] },
      });
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
