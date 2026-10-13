import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.spec.ts'],
    // Property tests run hundreds of encryptions; keep them deterministic and unhurried.
    testTimeout: 60_000,
    coverage: {
      provider: 'v8',
      include: ['src'],
      reporter: ['text', 'lcov'],
      // Faz 1 DoD: 100% line coverage of the crypto package.
      thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
    },
  },
});
