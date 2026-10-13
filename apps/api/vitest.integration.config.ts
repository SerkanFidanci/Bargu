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
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
