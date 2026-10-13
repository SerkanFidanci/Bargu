// One-shot migration step (container `migrate` in staging, `pnpm db:migrate` locally). The admin
// credentials exist only here, never in the API or worker.
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { migrate } from './migrate.js';

const env = z
  .object({
    DATABASE_ADMIN_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DB_APP_PASSWORD: z.string().min(16),
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
    log: (message) => process.stdout.write(`${message}\n`),
  });
} catch (error: unknown) {
  process.stderr.write(`Migration failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exit(1);
}
