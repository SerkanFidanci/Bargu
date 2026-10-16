// The cosmetic pass (docs/ADR/0025 §1): the server signs which packs an account has, the viewer's
// phone checks it before showing a look. A pass that does not hold shows the plain look.
import { type CosmeticPass, cosmeticPassSchema } from '@bargu/schemas';

import { KEY_BYTES, LABELS } from './constants.js';
import { concatBytes, fromBase64url, toBase64url, u32be, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import { ed25519PublicKey, signWithLabel, verifyWithLabel } from './primitives.js';

type Unsigned = Omit<CosmeticPass, 'sig'>;

const ascii = (text: string) => Uint8Array.from(text, (char) => char.charCodeAt(0));
/** A whole number of milliseconds as 8 big-endian bytes (no BigInt: Hermes and Node alike). */
const u64be = (value: number) =>
  concatBytes(u32be(Math.floor(value / 0x1_0000_0000)), u32be(value % 0x1_0000_0000));

/**
 * The signed bytes, fixed and unambiguous (not JSON): 0x01 ‖ len(kid) ‖ kid ‖ userId(16) ‖
 * issuedAt(8) ‖ expiresAt(8) ‖ count ‖ (len ‖ pack)… Ids are ASCII by their schemas.
 */
function passBytes(pass: Unsigned): Uint8Array {
  const kid = ascii(pass.kid);
  return concatBytes(
    Uint8Array.of(pass.v, kid.length),
    kid,
    uuidToBytes(pass.userId),
    u64be(pass.issuedAt),
    u64be(pass.expiresAt),
    Uint8Array.of(pass.packs.length),
    ...pass.packs.map((pack) => concatBytes(Uint8Array.of(pack.length), ascii(pack))),
  );
}

/** Packs as a pass names them: each once, in order. */
const canonical = (packs: readonly string[]) => [...new Set(packs)].sort();

/** The server signs an account's packs (apps/api); `secretKey` is ENTITLEMENT_SIGNING_KEY. */
export function issueCosmeticPass(input: {
  secretKey: Uint8Array;
  kid: string;
  userId: string;
  packs: readonly string[];
  issuedAt: number;
  expiresAt: number;
}): CosmeticPass {
  if (input.secretKey.length !== KEY_BYTES) {
    throw new BarguCryptoError('INVALID_KEY', 'cosmetic signing key must be 32 bytes');
  }
  const unsigned: Unsigned = {
    v: 1,
    kid: input.kid,
    userId: input.userId,
    packs: canonical(input.packs),
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
  };
  // The schema bounds every field, the number of packs too (COSMETIC_PASS_MAX_PACKS).
  if (!cosmeticPassSchema.omit({ sig: true }).safeParse(unsigned).success) {
    throw new BarguCryptoError('MALFORMED', 'invalid cosmetic pass');
  }
  const sig = signWithLabel(LABELS.cosmeticPass, passBytes(unsigned), input.secretKey);
  return { ...unsigned, sig: toBase64url(sig) };
}

/**
 * The packs a pass gives `userId` now, or null when it does not hold: not well formed, a key this
 * app does not trust (unknown `kid`), a wrong signature, expired, or someone else's. Never throws:
 * a look that cannot be checked is simply shown plain.
 */
export function verifyCosmeticPass(
  pass: unknown,
  input: { keys: ReadonlyMap<string, Uint8Array>; userId: string; now: number },
): ReadonlySet<string> | null {
  const parsed = cosmeticPassSchema.safeParse(pass);
  if (!parsed.success) return null;
  const { sig, ...unsigned } = parsed.data;
  if (unsigned.userId !== input.userId) return null;
  if (unsigned.expiresAt <= input.now || unsigned.issuedAt > unsigned.expiresAt) return null;
  // Only the one canonical form is signed: a reordered or repeated list is not this pass.
  const packs = canonical(unsigned.packs);
  if (
    packs.length !== unsigned.packs.length ||
    packs.some((pack, i) => pack !== unsigned.packs[i])
  ) {
    return null;
  }
  const key = input.keys.get(unsigned.kid);
  if (key === undefined) return null;
  // The schema took exactly 86 base64url characters: 64 bytes, so this cannot throw.
  const signature = fromBase64url(sig);
  return verifyWithLabel(LABELS.cosmeticPass, passBytes(unsigned), signature, key)
    ? new Set(packs)
    : null;
}

/** The public half of a signing key, for the apps' list of trusted keys. */
export function cosmeticPublicKey(secretKey: Uint8Array): string {
  return toBase64url(ed25519PublicKey(secretKey));
}

/**
 * The keys an app trusts, from its build's configuration: `kid:base64url` pairs separated by
 * commas (EXPO_PUBLIC_COSMETIC_KEYS). An entry that is not a valid key is left out.
 */
export function parseCosmeticKeys(config: string | undefined): ReadonlyMap<string, Uint8Array> {
  const keys = new Map<string, Uint8Array>();
  for (const entry of (config ?? '').split(',')) {
    const [kid, key] = entry.trim().split(':');
    if (kid === undefined || key === undefined || !/^[a-z0-9-]{1,16}$/.test(kid)) continue;
    try {
      const bytes = fromBase64url(key, KEY_BYTES);
      keys.set(kid, bytes);
    } catch {
      // Not a key: left out.
    }
  }
  return keys;
}
