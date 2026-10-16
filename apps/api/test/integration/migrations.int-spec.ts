import { getTableConfig } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';

import { schema } from '../../src/db/schema.js';
import { migrate } from '../../src/db/migrate.js';

let admin: Pool;
const options = () => ({
  adminUrl: inject('databaseAdminUrl'),
  appPassword: 'integration-tests-app-role-password',
  migrationsDir: inject('migrationsDir'),
  // The shared test database keeps test purchases on (global-setup).
  billingTest: true,
});

beforeAll(() => {
  admin = new Pool({ connectionString: inject('databaseAdminUrl'), max: 1 });
});
afterAll(async () => {
  await admin.end();
});

describe('migrations', () => {
  it('are idempotent: a second run applies nothing', async () => {
    expect(await migrate(options())).toEqual([]);
  });

  it('refuse to run when an applied migration was edited', async () => {
    const { rows } = await admin.query<{ checksum: string }>(
      `SELECT checksum FROM app.schema_migrations WHERE name = '0001_auth.sql'`,
    );
    const original = rows[0]?.checksum ?? '';
    await admin.query(
      `UPDATE app.schema_migrations SET checksum = 'edited' WHERE name = '0001_auth.sql'`,
    );
    try {
      await expect(migrate(options())).rejects.toThrow(/modified after it ran/);
    } finally {
      await admin.query(
        `UPDATE app.schema_migrations SET checksum = $1 WHERE name = '0001_auth.sql'`,
        [original],
      );
    }
  });

  // "Re-assert the runtime role attributes on every run" is checked in global-setup.ts, before
  // any test runs: it briefly gives the shared runtime role BYPASSRLS.

  it('match the typed Drizzle schema column for column', async () => {
    for (const table of Object.values(schema)) {
      const config = getTableConfig(table);
      const { rows } = await admin.query<{ column: string; nullable: string }>(
        `SELECT column_name AS column, is_nullable AS nullable FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 ORDER BY column_name`,
        [config.schema, config.name],
      );
      const database = rows.map(
        (row) => `${row.column}:${row.nullable === 'YES' ? 'null' : 'not null'}`,
      );
      const typed = config.columns
        .map((column) => `${column.name}:${column.notNull ? 'not null' : 'null'}`)
        .sort();
      expect(typed, config.name).toEqual(database);
    }
  });
});
