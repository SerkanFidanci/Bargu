import { parseNoticeKeys, toBase64url } from '@bargu/crypto';

/**
 * The server notice keys this build trusts (QA-28 B-1, docs/ADR/0016 Ek), from its build profile
 * (eas.json): preview builds trust staging's, production builds production's only. A build with
 * none takes no server notice at all. Several at once while a key is being changed.
 */
export const trustedNoticeKeys: ReadonlyMap<string, Uint8Array> = parseNoticeKeys(
  // Static `process.env.EXPO_PUBLIC_*` access is required for Expo to inline the value.
  process.env.EXPO_PUBLIC_NOTICE_KEYS,
);

/** The same keys as the iOS notification extension reads them: kid → base64url. */
export function sharedNoticeKeys(keys = trustedNoticeKeys): Record<string, string> {
  return Object.fromEntries([...keys].map(([kid, key]) => [kid, toBase64url(key)]));
}
