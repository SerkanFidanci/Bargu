import { parseCosmeticKeys } from '@bargu/crypto';

/**
 * The server keys this build trusts for cosmetic passes (docs/ADR/0025 §2), from its build profile
 * (eas.json): preview builds trust staging's, production builds production's only, so a test pack
 * from staging never shows in production. Several at once while a key is being changed.
 */
export const trustedKeys: ReadonlyMap<string, Uint8Array> = parseCosmeticKeys(
  // Static `process.env.EXPO_PUBLIC_*` access is required for Expo to inline the value.
  process.env.EXPO_PUBLIC_COSMETIC_KEYS,
);
