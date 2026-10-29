import { createConfig } from '@bargu/config/eslint';
import expo from 'eslint-plugin-expo';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

// eslint-config-expo is not used: its eslint-plugin-react / eslint-plugin-import dependencies call
// context APIs removed in ESLint 10. The parts that matter are wired directly (see docs/ADR/0001).
const config = createConfig({
  tsconfigRootDir: import.meta.dirname,
  environment: 'react-native',
  // Animations run as Reanimated worklets on the UI thread (CLAUDE.md); the JS-thread APIs are banned.
  restrictedImports: [
    {
      name: 'react-native',
      importNames: ['Animated', 'LayoutAnimation'],
      message:
        'Animate with react-native-reanimated (UI thread) and tokens from src/theme/motion.ts.',
    },
  ],
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

// "No animation numbers outside the motion tokens" (CLAUDE.md): springs, durations and delays come
// from src/theme/motion.ts. Target values (opacity 0 → 1, a translation) are data, not tokens.
const MOTION_ONLY =
  'Use the motion tokens from @/theme (spring, timing, duration) instead of a literal.';
config.push({
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/theme/motion.ts'],
  rules: {
    'no-restricted-syntax': [
      'error',
      {
        selector:
          'Property[key.name=/^(duration|delay|damping|dampingRatio|stiffness|mass|velocity)$/] > Literal',
        message: MOTION_ONLY,
      },
      {
        selector: "CallExpression[callee.name='withDelay'] > Literal.arguments:first-child",
        message: MOTION_ONLY,
      },
      {
        selector:
          'CallExpression[callee.property.name=/^(duration|delay|damping|dampingRatio|stiffness|mass)$/] > Literal',
        message: MOTION_ONLY,
      },
      // Edge to edge on Android, the window does not shrink for the keyboard: a view with no
      // behavior leaves the text field under it (the owner, 2026-10-30; src/ui/keyboard.ts).
      {
        selector:
          "JSXOpeningElement[name.name='KeyboardAvoidingView'] JSXAttribute[name.name='behavior'] Identifier[name='undefined']",
        message:
          'Use KEYBOARD_BEHAVIOR from @/ui/keyboard: with no behavior Android hides the field.',
      },
      {
        selector:
          "JSXOpeningElement[name.name='KeyboardAvoidingView']:not(:has(JSXAttribute[name.name='behavior']))",
        message:
          'Use KEYBOARD_BEHAVIOR from @/ui/keyboard: with no behavior Android hides the field.',
      },
    ],
  },
});

export default config;
