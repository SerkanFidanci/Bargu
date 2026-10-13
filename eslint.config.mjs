// Lints repo-root files only. Each workspace package has its own eslint.config.mjs, which ESLint 10
// picks up for files inside that package.
import { createConfig } from '@bargu/config/eslint';

export default createConfig({ tsconfigRootDir: import.meta.dirname });
