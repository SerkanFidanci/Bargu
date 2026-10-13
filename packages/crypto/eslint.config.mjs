import { createConfig } from '@bargu/config/eslint';

// The only package allowed to import cryptographic libraries (CLAUDE.md).
export default createConfig({ tsconfigRootDir: import.meta.dirname, allowCrypto: true });
