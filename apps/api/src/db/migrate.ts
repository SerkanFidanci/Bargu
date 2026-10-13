import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256 } from '@bargu/crypto';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';

import { JOBS_SCHEMA, QUEUE_DEFINITIONS } from '../jobs/queues.js';

/** Owns every table; NOLOGIN, reachable only through SET ROLE by the migrator. */
export const OWNER_ROLE = 'bargu_owner';
/** The only role the API and worker log in with: no ownership, no RLS bypass. */
export const APP_ROLE = 'bargu_app';

export interface MigrateOptions {
  /** Superuser (or CREATEROLE) connection; used only by this step, never by the API. */
  adminUrl: string;
  /** Password set for the runtime role (DATABASE_URL of the API and worker). */
  appPassword: string;
  migrationsDir: string;
  log?: (message: string) => void;
}

// Any constant works; it only has to be the same for every migrator of this database.
const MIGRATION_LOCK_ID = 0x6261_7267;

/**
 * Brings the database to the current schema, idempotently: roles, application schema, SQL
 * migrations (each in its own transaction, recorded with a checksum), the job tables and their
 * queues. Concurrent runs wait on an advisory lock. Returns the migrations applied by this run.
 */
export async function migrate(options: MigrateOptions): Promise<string[]> {
  const log = options.log ?? (() => undefined);
  const client = new Client({
    connectionString: options.adminUrl,
    application_name: 'bargu-migrate',
  });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await bootstrapRoles(client, options.appPassword);
    const applied = await applyMigrations(client, options.migrationsDir, log);
    await installJobs(client);
    log(applied.length > 0 ? `applied: ${applied.join(', ')}` : 'schema up to date');
    return applied;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    await client.end();
  }
}

async function bootstrapRoles(client: Client, appPassword: string): Promise<void> {
  if (appPassword.length < 16) throw new Error('DB_APP_PASSWORD must be at least 16 characters');
  const owner = client.escapeIdentifier(OWNER_ROLE);
  const app = client.escapeIdentifier(APP_ROLE);
  await client.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${OWNER_ROLE}') THEN
        CREATE ROLE ${owner} NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
        CREATE ROLE ${app} LOGIN;
      END IF;
    END $$`);
  // Re-asserted on every run so a manual change cannot silently weaken them.
  await client.query(`ALTER ROLE ${owner} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS`);
  await client.query(
    `ALTER ROLE ${app} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT ` +
      `CONNECTION LIMIT 40 PASSWORD ${client.escapeLiteral(appPassword)}`,
  );
  const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
  const database = client.escapeIdentifier(rows[0]?.db ?? '');
  await client.query(`REVOKE ALL ON DATABASE ${database} FROM PUBLIC`);
  await client.query(`GRANT CONNECT ON DATABASE ${database} TO ${app}`);
  await client.query('REVOKE ALL ON SCHEMA public FROM PUBLIC');
  await client.query(`CREATE SCHEMA IF NOT EXISTS app AUTHORIZATION ${owner}`);
  await client.query(`GRANT USAGE ON SCHEMA app TO ${app}`);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${JOBS_SCHEMA} AUTHORIZATION ${owner}`);
  await client.query(
    `CREATE TABLE IF NOT EXISTS app.schema_migrations (
       name text PRIMARY KEY,
       checksum text NOT NULL,
       applied_at timestamptz NOT NULL DEFAULT now()
     )`,
  );
  await client.query(`ALTER TABLE app.schema_migrations OWNER TO ${owner}`);
}

async function applyMigrations(
  client: Client,
  directory: string,
  log: (message: string) => void,
): Promise<string[]> {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- the shipped migrations directory, resolved from this module's location
  const files = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name));
  files.sort();
  const { rows } = await client.query<{ name: string; checksum: string }>(
    'SELECT name, checksum FROM app.schema_migrations',
  );
  const done = new Map(rows.map((row) => [row.name, row.checksum]));
  const applied: string[] = [];

  for (const name of files) {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- names come from readdir of the shipped migrations directory and match a strict pattern
    const sql = await readFile(join(directory, name), 'utf8');
    const checksum = Buffer.from(sha256(new TextEncoder().encode(sql))).toString('hex');
    const previous = done.get(name);
    if (previous !== undefined) {
      // A migration that already ran must never change; add a new one instead.
      if (previous !== checksum) throw new Error(`migration ${name} was modified after it ran`);
      continue;
    }
    log(`applying ${name}`);
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL ROLE ${client.escapeIdentifier(OWNER_ROLE)}`);
      await client.query(sql);
      await client.query('INSERT INTO app.schema_migrations (name, checksum) VALUES ($1, $2)', [
        name,
        checksum,
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    applied.push(name);
  }
  return applied;
}

/** pg-boss tables and queues, owned by the owner role; the app role gets data access only. */
async function installJobs(client: Client): Promise<void> {
  await client.query(`SET ROLE ${client.escapeIdentifier(OWNER_ROLE)}`);
  try {
    const boss = new PgBoss({
      db: { executeSql: (text, values) => client.query(text, values) },
      schema: JOBS_SCHEMA,
      createSchema: false,
      supervise: false,
      schedule: false,
    });
    await boss.start();
    const existing = new Set((await boss.getQueues()).map((queue) => queue.name));
    for (const [name, queueOptions] of QUEUE_DEFINITIONS) {
      if (existing.has(name)) await boss.updateQueue(name, queueOptions);
      else await boss.createQueue(name, queueOptions);
    }
    await boss.stop({ graceful: false, close: false });

    const app = client.escapeIdentifier(APP_ROLE);
    await client.query(`GRANT USAGE ON SCHEMA ${JOBS_SCHEMA} TO ${app}`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${JOBS_SCHEMA} TO ${app}`,
    );
    await client.query(`GRANT USAGE ON ALL SEQUENCES IN SCHEMA ${JOBS_SCHEMA} TO ${app}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${JOBS_SCHEMA} TO ${app}`);
  } finally {
    await client.query('RESET ROLE');
  }
}
