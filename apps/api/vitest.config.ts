import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Vite's default transform does not emit decorator metadata, which Nest's DI relies on.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src'],
      exclude: ['src/main.ts', 'src/healthcheck.ts'],
      reporter: ['text', 'lcov'],
    },
  },
});
