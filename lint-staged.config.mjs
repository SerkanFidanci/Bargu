import { defineConfig } from 'lint-staged/config';

export default defineConfig({
  // Invisible / bidi-control characters (Trojan Source) in any staged text file.
  '*': 'node scripts/check-invisible-chars.mjs',
  // The notice-key.sh text kept inside apply-pending.sh must stay current (once per commit).
  'infra/staging/{apply-pending,notice-key}.sh': () => 'node scripts/check-embedded-copies.mjs',
  '*.{ts,tsx,mts,cts,js,mjs,cjs}': [
    'eslint --max-warnings=0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,md,yml,yaml}': 'prettier --write --ignore-unknown',
});
