// The cosmetic pass (docs/ADR/0025 §1): the server signs which packs an account has, the viewer's
// phone checks it before showing a look. A pass that does not hold shows the plain look.
import { type CosmeticPass, cosmeticPassSchema } from '@bargu/schemas';

import { KEY_BYTES, LABELS } from './constants.js';
import {
  asciiBytes,
  concatBytes,
  fromBase64url,
  toBase64url,
  u64be,
  uuidToBytes,
} from './encoding.js';
import { BarguCryptoError } from './errors.js';
import { signWithLabel, verifyWithLabel } from './primitives.js';
import { parseTrustedKeys, signingPublicKey } from './trusted-keys.js';

type Unsigned = Omit<CosmeticPass, 'sig'>;

/**
 * The signed bytes, fixed and unambiguous (not JSON): 0x01 ‖ len(kid) ‖ kid ‖ userId(16) ‖
 * issuedAt(8) ‖ expiresAt(8) ‖ count ‖ (len ‖ pack)… Ids are ASCII by their schemas.
 */
function passBytes(pass: Unsigned): Uint8Array {
  const kid = asciiBytes(pass.kid);
  return concatBytes(
    Uint8Array.of(pass.v, kid.length),
    kid,
    uuidToBytes(pass.userId),
    u64be(pass.issuedAt),
    u64be(pass.expiresAt),
    Uint8Array.of(pass.packs.length),
    ...pass.packs.map((pack) => concatBytes(Uint8Array.of(pack.length), asciiBytes(pack))),
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
  try {
    return checkPass(pass, input);
  } catch {
    // A signature of 86 characters whose last one is not canonical (QA-28 B-2: it carries 4 spare
    // bits, only 4 of its 64 values decode strictly), or anything else unreadable: no pass.
    return null;
  }
}

function checkPass(
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
  return verifyWithLabel(LABELS.cosmeticPass, passBytes(unsigned), fromBase64url(sig), key)
    ? new Set(packs)
    : null;
}

/** The public half of a signing key, for the apps' list of trusted keys. */
export const cosmeticPublicKey = signingPublicKey;

/**
 * The keys an app trusts, from its build's configuration: `kid:base64url` pairs separated by
 * commas (EXPO_PUBLIC_COSMETIC_KEYS). An entry that is not a valid key is left out.
 */
export const parseCosmeticKeys = parseTrustedKeys;
