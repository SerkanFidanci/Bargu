import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
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

/** When a file in this repository's packages last changed; null when it is not there. */
function modifiedAt(path: string): number | null {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- paths inside packages/, built from this file's location
  return existsSync(path) ? statSync(path).mtimeMs : null;
}

/**
 * The packages the API runs as built code (their dist): built before their latest change, tests
 * fail far from the cause ("cosmeticPublicKey is not a function" after a checkout, QA 21). Stops
 * with what to run instead; CI builds them first (turbo: test:integration needs ^build).
 */
function assertPackagesBuilt(): void {
  const stale = ['crypto', 'schemas'].filter((name) => {
    const root = fileURLToPath(new URL(`../../../../packages/${name}/`, import.meta.url));
    const builtAt = modifiedAt(join(root, 'dist', 'index.js'));
    if (builtAt === null) return true;
    const src = join(root, 'src');
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- the package's own src, built from this file's location
    const files = readdirSync(src, { recursive: true, encoding: 'utf8' });
    return files
      .filter((file) => !file.endsWith('.spec.ts'))
      .some((file) => (modifiedAt(join(src, file)) ?? 0) > builtAt);
  });
  if (stale.length > 0) {
    throw new Error(
      `packages/{${stale.join(',')}}/dist is older than its src (or missing): run ` +
        `"pnpm --filter @bargu/schemas --filter @bargu/crypto build" first`,
    );
  }
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  assertPackagesBuilt();
  const database = `bargu_it_${String(Date.now())}_${String(process.pid)}`;
  const admin = new Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${admin.escapeIdentifier(database)}`);
  await admin.end();

  const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));
  const databaseAdminUrl = urlFor(ADMIN_URL, database);
  // Test purchases on, as on staging (billing.int-spec turns them off inside a rolled-back test).
  const run = {
    adminUrl: databaseAdminUrl,
    appPassword: APP_PASSWORD,
    migrationsDir,
    billingTest: true,
  };
  await migrate(run);

  // Every migration run re-asserts the runtime role's attributes (a drifted role could bypass RLS).
  // Checked here, before any test starts: it briefly changes a role shared by the whole cluster,
  // which would let concurrently running tests see rows they must not.
  const roleCheck = new Client({ connectionString: databaseAdminUrl });
  await roleCheck.connect();
  try {
    await roleCheck.query(`ALTER ROLE ${roleCheck.escapeIdentifier(APP_ROLE)} BYPASSRLS`);
    await migrate(run);
    const { rows } = await roleCheck.query<{ bypass: boolean }>(
      'SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = $1',
      [APP_ROLE],
    );
    if (rows[0]?.bypass !== false) {
      throw new Error('migrate did not take BYPASSRLS away from the runtime role');
    }
  } finally {
    await roleCheck.end();
  }

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
