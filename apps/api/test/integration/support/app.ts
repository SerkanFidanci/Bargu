import { generateToken } from '@bargu/crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { inject } from 'vitest';

import { AppModule } from '../../../src/app.module.js';
import { parseEnv, type Env } from '../../../src/config/env.js';
import {
  ATTESTATION_VERIFIERS,
  type AttestationVerifiers,
} from '../../../src/devices/attestation/attestation.service.js';
import { configureApp } from '../../../src/http/configure-app.js';
import { createHttpAdapter } from '../../../src/http/http-adapter.js';

export interface TestApp {
  app: NestFastifyApplication;
  env: Env;
  /** Superuser connection to the test database, for assertions only (never used by the app). */
  admin: Pool;
  close: () => Promise<void>;
}

/** Test-only secrets: fresh per app, so nothing here can ever match a real environment. */
export function testEnv(overrides: Record<string, string> = {}): Env {
  return parseEnv({
    NODE_ENV: 'test',
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: inject('databaseUrl'),
    REDIS_URL: inject('redisUrl'),
    JWT_SIGNING_KEY: generateToken(),
    OTP_KEY: generateToken(),
    EMAIL_LOOKUP_KEY: generateToken(),
    JOB_PAYLOAD_KEY: generateToken(),
    SMTP_URL: 'smtp://127.0.0.1:1',
    MAIL_FROM: 'Bargu <no-reply@example.test>',
    WEBAUTHN_RP_ID: 'bargu.example.test',
    WEBAUTHN_ORIGINS: 'https://bargu.example.test',
    ANDROID_CERT_SHA256: 'AA'.repeat(32),
    DEVICE_ATTESTATION: 'optional',
    ...overrides,
  });
}

export async function createTestApp(
  options: { env?: Env; verifiers?: AttestationVerifiers } = {},
): Promise<TestApp> {
  const env = options.env ?? testEnv();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(ATTESTATION_VERIFIERS)
    .useValue(options.verifiers ?? {})
    .compile();
  const app = configureApp(
    moduleRef.createNestApplication<NestFastifyApplication>(createHttpAdapter(env), {
      logger: false,
      rawBody: true,
    }),
  );
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  const admin = new Pool({ connectionString: inject('databaseAdminUrl'), max: 2 });
  return {
    app,
    env,
    admin,
    close: async () => {
      await app.close();
      await admin.end();
    },
  };
}
