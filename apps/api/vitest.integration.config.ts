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
    // test database's connection limit on many-core machines too.
    maxWorkers: 4,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
