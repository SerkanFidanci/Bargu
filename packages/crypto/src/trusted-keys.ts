// The server's signing keys an app trusts, from its build's configuration: the cosmetic pass
// (docs/ADR/0025 §2) and the server's notices (docs/ADR/0016, Ek 2026-10-21) each have their own.
import { KEY_BYTES } from './constants.js';
import { fromBase64url, toBase64url } from './encoding.js';
import { ed25519PublicKey, isValidEd25519PublicKey } from './primitives.js';

/** A key id (`kid`): what the apps know a server key by. */
export const SIGNING_KID = /^[a-z0-9-]{1,16}$/;

/**
 * `kid:base64url` pairs separated by commas (EXPO_PUBLIC_COSMETIC_KEYS, EXPO_PUBLIC_NOTICE_KEYS).
 * An entry that is not a valid Ed25519 public key (small-order keys included) is left out.
 */
export function parseTrustedKeys(config: string | undefined): ReadonlyMap<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  for (const entry of (config ?? '').split(',')) {
    const [kid, key] = entry.trim().split(':');
    if (kid === undefined || key === undefined || !SIGNING_KID.test(kid)) continue;
    try {
      const bytes = fromBase64url(key, KEY_BYTES);
      if (isValidEd25519PublicKey(bytes)) keys.set(kid, bytes);
    } catch {
      // Not a key: left out.
    }
  }
  return keys;
}

/** The public half of a server signing key, for the apps' list of trusted keys. */
export function signingPublicKey(secretKey: Uint8Array): string {
  return toBase64url(ed25519PublicKey(secretKey));
}
