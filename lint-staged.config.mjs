import { defineConfig } from 'lint-staged/config';

export default defineConfig({
  // Invisible / bidi-control characters (Trojan Source) in any staged text file.
  '*': 'node scripts/check-invisible-chars.mjs',
  '*.{ts,tsx,mts,cts,js,mjs,cjs}': [
    'eslint --max-warnings=0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,md,yml,yaml}': 'prettier --write --ignore-unknown',
});
