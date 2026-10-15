import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests against real Postgres and Redis (`pnpm infra:up` locally, service containers in
 * CI). Each run gets a fresh database with all migrations applied (test/integration/global-setup).
 */
export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    // Nest and @peculiar/x509 rely on the metadata polyfill, which entry points load first.
    setupFiles: ['reflect-metadata'],
    include: ['test/integration/**/*.int-spec.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    // Each file runs whole apps (database and queue pools): a few at a time stay well under the
    // test database's connection limit on many-core machines too. That holds for ONE run: two runs
    // against the same test Postgres at once (two sessions, a run beside a single file) go over the
    // app role's connection limit ("too many connections for role bargu_app") and the busiest
    // files (event-load, event-circles) fail for that alone (QA 6a G-5). Run one at a time.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
