import { expect } from 'vitest';

import type { DatabaseService } from '../../../src/infra/database/database.service.js';

/**
 * Every table that belongs to a user, with the column naming its owner. Adding a user-owned table
 * means adding it here; the RLS catalog test fails until every table in `app` has forced RLS.
 */
export const userOwnedTables = [
  'users',
  'devices',
  'passkeys',
  'refresh_tokens',
  'security_events',
] as const;
const ownerColumn = (table: string) => (table === 'users' ? 'id' : 'user_id');

/**
 * Authorisation helper ("başka kullanıcı erişemez"): acting as `viewer`, every user-owned table
 * shows rows of `viewer` only and none of `other`.
 */
export async function expectOwnRowsOnly(
  database: DatabaseService,
  viewer: string,
  other: string,
): Promise<void> {
  await database.asUser(viewer, async (tx) => {
    for (const table of userOwnedTables) {
      const column = ownerColumn(table);
      const result = await tx.execute(
        `SELECT count(*) FILTER (WHERE ${column} = '${viewer}')::int AS own,
                count(*) FILTER (WHERE ${column} = '${other}')::int AS foreign,
                count(*)::int AS total
           FROM app.${table}`,
      );
      const row = result.rows[0] as { own: number; foreign: number; total: number };
      expect(row.own, `${table}: own rows`).toBeGreaterThan(0);
      expect(row.foreign, `${table}: rows of another user`).toBe(0);
      expect(row.total, `${table}: rows of anyone else`).toBe(row.own);
    }
  });
}
