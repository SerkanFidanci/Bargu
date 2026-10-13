import { createConfig } from '@bargu/config/eslint';
import expo from 'eslint-plugin-expo';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// eslint-config-expo is not used: its eslint-plugin-react / eslint-plugin-import dependencies call
// context APIs removed in ESLint 10. The parts that matter are wired directly (see docs/ADR/0001).
const config = createConfig({
  tsconfigRootDir: import.meta.dirname,
  environment: 'react-native',
  extends: [
    // Rules of Hooks plus the React Compiler rules (the app enables `experiments.reactCompiler`).
    reactHooks.configs.flat['recommended-latest'],
    {
      plugins: { expo },
      rules: {
        // EXPO_PUBLIC_* values are inlined only for static `process.env.X` access.
        'expo/no-env-var-destructuring': 'error',
        'expo/no-dynamic-env-var': 'error',
      },
    },
    {
      languageOptions: { globals: { ...globals['shared-node-browser'], __DEV__: 'readonly' } },
    },
    {
      // Config files evaluated by Node (Expo CLI, Jest, EAS).
      files: ['*.config.{ts,js,mjs,cjs}'],
      languageOptions: { globals: globals.node },
    },
  ],
});

// The one documented exception to "crypto only in packages/crypto": exposing the OS CSPRNG from
// expo-crypto as `crypto.getRandomValues` (platform glue, no cryptography; see docs/ADR/0004).
config.push({
  files: ['src/platform/secure-random.ts'],
  rules: { 'no-restricted-imports': 'off' },
});

export default config;
