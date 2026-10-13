import { defineConfig } from 'lint-staged/config';

export default defineConfig({
  '*.{ts,tsx,mts,cts,js,mjs,cjs}': [
    'eslint --max-warnings=0 --no-warn-ignored',
    'prettier --write',
  ],
  '*.{json,md,yml,yaml}': 'prettier --write --ignore-unknown',
});
