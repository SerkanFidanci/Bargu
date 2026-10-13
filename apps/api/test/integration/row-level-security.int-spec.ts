import { randomUuid } from '@bargu/crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { APP_ROLE } from '../../src/db/migrate.js';
import { DatabaseService } from '../../src/infra/database/database.service.js';
import { createTestApp, type TestApp } from './support/app.js';
import { login, uniqueEmail } from './support/client.js';
import { expectOwnRowsOnly, userOwnedTables } from './support/isolation.js';

let test: TestApp;
let pool: Pool;
let database: DatabaseService;
let alice: string;
let bob: string;

beforeAll(async () => {
  test = await createTestApp();
  pool = new Pool({ connectionString: test.env.DATABASE_URL, max: 2 });
  database = new DatabaseService(pool);
  alice = (await login(test, uniqueEmail())).session.userId;
  bob = (await login(test, uniqueEmail())).session.userId;
  // A passkey row for each, so every user-owned table has data for both accounts.
  for (const userId of [alice, bob]) {
    await test.admin.query(
      `INSERT INTO app.passkeys (credential_id, user_id, public_key, backed_up)
       VALUES ($1, $2, '\\x00', false)`,
      [Buffer.from(randomUuid().replaceAll('-', ''), 'hex'), userId],
    );
  }
});
afterAll(async () => {
  await pool.end();
  await test.close();
});

describe('row-level security (Faz 2 DoD)', () => {
  it('protects every table of the application schema, forced, without exceptions', async () => {
    const { rows } = await test.admin.query<{ table: string; enabled: boolean; forced: boolean }>(
      `SELECT c.relname AS table, c.relrowsecurity AS enabled, c.relforcerowsecurity AS forced
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'app' AND c.relkind = 'r' AND c.relname <> 'schema_migrations'`,
    );
    // A new table without RLS fails here, before it can leak anything.
    expect(rows.length).toBeGreaterThanOrEqual(userOwnedTables.length);
    for (const row of rows) expect(row, row.table).toMatchObject({ enabled: true, forced: true });
  });

  it('returns 0 rows from every table when app.user_id is not set', async () => {
    for (const table of userOwnedTables) {
      const { rows } = await pool.query(`SELECT * FROM app.${table}`);
      expect(rows, table).toHaveLength(0);
    }
    await database.anonymous(async (tx) => {
      for (const table of userOwnedTables) {
        const result = await tx.execute(`SELECT count(*)::int AS n FROM app.${table}`);
        expect(result.rows[0], table).toEqual({ n: 0 });
      }
    });
  });

  it('shows each user only their own rows', async () => {
    await expectOwnRowsOnly(database, alice, bob);
    await expectOwnRowsOnly(database, bob, alice);
  });

  it("refuses writes into another user's rows", async () => {
    await expect(
      database.asUser(alice, (tx) =>
        tx.execute(`INSERT INTO app.security_events (user_id, type) VALUES ('${bob}', 'logout')`),
      ),
    ).rejects.toMatchObject({
      // Drizzle wraps the driver error; the cause is Postgres refusing the row.
      cause: { message: expect.stringMatching(/row-level security/) as unknown },
    });
    const updated = await database.asUser(alice, (tx) =>
      tx.execute(`UPDATE app.users SET display_name = 'x' WHERE id = '${bob}'`),
    );
    expect(updated.rowCount).toBe(0);
  });

  it('does not leak the user id into the next transaction on a pooled connection', async () => {
    await database.asUser(alice, () => Promise.resolve());
    const { rows } = await pool.query<{ id: string | null }>(
      `SELECT current_setting('app.user_id', true) AS id`,
    );
    expect(rows[0]?.id ?? '').toBe('');
  });

  it('runs the API as a role that owns nothing and cannot bypass RLS', async () => {
    const { rows } = await pool.query<{
      role: string;
      bypass: boolean;
      superuser: boolean;
      owns: number;
    }>(
      `SELECT current_user AS role, r.rolbypassrls AS bypass, r.rolsuper AS superuser,
              (SELECT count(*)::int FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname IN ('app', 'pgboss') AND c.relowner = r.oid) AS owns
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    expect(rows[0]).toEqual({ role: APP_ROLE, bypass: false, superuser: false, owns: 0 });
    await expect(pool.query('DROP TABLE app.users')).rejects.toThrow(/must be owner/);
    await expect(pool.query('CREATE TABLE app.sneaky (id int)')).rejects.toThrow(
      /permission denied/,
    );
    // Turning row security off does not bypass it: queries that would be filtered fail instead.
    await expect(pool.query(`SET row_security = off; SELECT * FROM app.users`)).rejects.toThrow(
      /row-level security/,
    );
  });

  it('allows the one pre-login lookup only with the keyed email hash', async () => {
    expect(await database.userIdForEmail(new Uint8Array(32))).toBeNull();
    await expect(pool.query('SELECT email_hmac FROM app.users')).resolves.toMatchObject({
      rowCount: 0,
    });
  });
});
