import js from '@eslint/js';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import security from 'eslint-plugin-security';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const CRYPTO_ONLY =
  'Crypto code lives only in packages/crypto (see CLAUDE.md). Use the @bargu/crypto API instead.';

/**
 * Shared Bargu ESLint config.
 *
 * @param {object} options
 * @param {string} options.tsconfigRootDir Directory of the consuming package (`import.meta.dirname`).
 * @param {'node' | 'react-native'} [options.environment]
 * @param {boolean} [options.allowCrypto] Only `packages/crypto` may set this.
 * @param {import('eslint').Linter.Config[]} [options.extends] Framework presets applied before Bargu rules.
 * @param {{ name: string, importNames?: string[], message: string }[]} [options.restrictedImports]
 *   Package-specific import bans, merged with the crypto rule (one rule cannot be configured twice).
 */
export function createConfig({
  tsconfigRootDir,
  environment = 'node',
  allowCrypto = false,
  extends: presets = [],
  restrictedImports = [],
}) {
  return defineConfig([
    globalIgnores([
      '**/dist/',
      '**/build/',
      '**/coverage/',
      '**/.turbo/',
      '**/.expo/',
      '**/.vitest/',
      '**/android/',
      '**/ios/',
      '**/expo-env.d.ts',
    ]),
    {
      linterOptions: {
        reportUnusedDisableDirectives: 'error',
        reportUnusedInlineConfigs: 'error',
      },
    },
    js.configs.recommended,
    ...presets,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    security.configs.recommended,
    eslintComments.recommended,
    {
      languageOptions: {
        globals: environment === 'node' ? globals.node : {},
        parserOptions: { projectService: true, tsconfigRootDir },
      },
      rules: {
        'no-console': 'error',
        eqeqeq: ['error', 'always'],
        'no-restricted-properties': [
          'error',
          {
            object: 'Math',
            property: 'random',
            message: 'Math.random is not a CSPRNG. Use the RNG exported by @bargu/crypto.',
          },
        ],
        'no-restricted-imports': allowCrypto
          ? 'off'
          : [
              'error',
              {
                paths: [
                  ...['crypto', 'node:crypto', 'expo-crypto', 'crypto-js', 'tweetnacl'].map(
                    (name) => ({ name, message: CRYPTO_ONLY }),
                  ),
                  ...restrictedImports,
                ],
                patterns: [{ group: ['@noble/*', 'libsodium*'], message: CRYPTO_ONLY }],
              },
            ],
        // `any` and `@ts-ignore` are banned; `@ts-expect-error` needs a written reason.
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/ban-ts-comment': [
          'error',
          {
            'ts-expect-error': 'allow-with-description',
            'ts-ignore': true,
            'ts-nocheck': true,
            minimumDescriptionLength: 10,
          },
        ],
        // Every eslint-disable must carry a justification (`-- reason`).
        '@eslint-community/eslint-comments/require-description': 'error',
        '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
        // Flags every `obj[key]` access; with noUncheckedIndexedAccess and zod-validated input it is
        // almost exclusively false positives and would push people towards eslint-disable comments.
        'security/detect-object-injection': 'off',
        // NestJS modules are intentionally empty classes carrying a decorator.
        '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      },
    },
    {
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  ]);
}
