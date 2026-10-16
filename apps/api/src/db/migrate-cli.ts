// One-shot migration step (container `migrate` in staging, `pnpm db:migrate` locally). The admin
// credentials exist only here, never in the API or worker.
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { billingTestOn } from '../config/env.js';
import { migrate } from './migrate.js';

const env = z
  .object({
    DATABASE_ADMIN_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_APP_PASSWORD: z.string().min(16),
    // Test purchases in the database too (docs/ADR/0024 §6): the same rule as the API's.
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    BILLING_TEST: z.enum(['on', 'off']).optional(),
  })
  .safeParse(process.env);

if (!env.success) {
  process.stderr.write(
    `Invalid migration environment: ${env.error.issues.map((issue) => issue.path.join('.')).join(', ')}\n`,
  );
  process.exit(1);
}

try {
  await migrate({
    adminUrl: env.data.DATABASE_ADMIN_URL,
    appPassword: env.data.DB_APP_PASSWORD,
    migrationsDir: fileURLToPath(new URL('../../migrations', import.meta.url)),
    billingTest: billingTestOn(env.data),
    log: (message) => process.stdout.write(`${message}\n`),
  });
} catch (error: unknown) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
