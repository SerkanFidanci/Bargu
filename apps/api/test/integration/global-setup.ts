import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { createClient } from 'redis';
import type { TestProject } from 'vitest/node';

import { APP_ROLE, migrate } from '../../src/db/migrate.js';

// Defaults match the test services in infra/docker-compose.yml; CI sets the same values.
const ADMIN_URL =
  process.env.TEST_DATABASE_ADMIN_URL ??
  'postgres://postgres:integration-tests-only@127.0.0.1:5433/postgres';
const REDIS_URL =
  process.env.TEST_REDIS_URL ?? 'redis://default:integration-tests-only@127.0.0.1:6380';
const APP_PASSWORD = 'integration-tests-app-role-password';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
    databaseAdminUrl: string;
    redisUrl: string;
    migrationsDir: string;
  }
}

function urlFor(base: string, database: string, login?: { role: string; secret: string }): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  if (login) {
    url.username = login.role;
    url.password = login.secret;
  }
  return url.toString();
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const database = `bargu_it_${String(Date.now())}_${String(process.pid)}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(database)}`);
  await admin.end();

  const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
  const databaseAdminUrl = urlFor(ADMIN_URL, database);
  await migrate({ adminUrl: databaseAdminUrl, appPassword: APP_PASSWORD, migrationsDir });

  const redis = createClient({ url: REDIS_URL });
  await redis.connect();
  await redis.flushAll();
  await redis.close();

  project.provide(
    'databaseUrl',
    urlFor(ADMIN_URL, database, { role: APP_ROLE, secret: APP_PASSWORD }),
  );
  project.provide('databaseAdminUrl', databaseAdminUrl);
  project.provide('redisUrl', REDIS_URL);
  project.provide('migrationsDir', migrationsDir);

  return async () => {
    const cleanup = new Client({ connectionString: ADMIN_URL });
    await cleanup.connect();
    await cleanup.query(
      `DROP DATABASE IF EXISTS ${cleanup.escapeIdentifier(database)} WITH (FORCE)`,
    );
    await cleanup.end();
  };
}
