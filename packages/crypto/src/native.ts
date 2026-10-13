import { equalBytes } from '@noble/ciphers/utils.js';
import { ed25519, x25519 } from '@noble/curves/ed25519.js';

import {
  nativeCurvePrimitivesActive,
  randomBytes,
  setNativeCurvePrimitives,
  type NativeCurvePrimitives,
} from './primitives.js';

export type NativeInstallResult = { active: true } | { active: false; reason: string };

// Ed25519 group order L, little-endian: adding it to S gives a malleated, non-canonical signature.
const GROUP_ORDER = 2n ** 252n + 27742317777372353535851937790883648493n;

function malleate(signature: Uint8Array): Uint8Array {
  let s = 0n;
  for (const byte of Array.from(signature.subarray(32)).reverse()) s = (s << 8n) | BigInt(byte);
  s += GROUP_ORDER;
  const out = signature.slice();
  for (let i = 32; i < 64; i++) {
    out[i] = Number(s & 0xffn);
    s >>= 8n;
  }
  return out;
}

function flipped(bytes: Uint8Array): Uint8Array {
  return bytes.map((byte, index) => (index === 0 ? byte ^ 1 : byte));
}

/**
 * Checks a platform implementation against the audited reference (noble) on fresh random inputs,
 * then routes the curve operations to it. Any disagreement, exception or laxness (a tampered,
 * foreign or malleated signature accepted) keeps the reference: native code can only make the
 * app faster, never weaker. Signatures are compared by verification, not byte for byte, because
 * Apple CryptoKit signs with randomness (still valid RFC 8032).
 */
export function installNativePrimitives(
  candidate: NativeCurvePrimitives,
  rounds = 2,
): NativeInstallResult {
  const fail = (reason: string): NativeInstallResult => ({ active: false, reason });
  try {
    for (let round = 0; round < rounds; round++) {
      const seed = randomBytes(32);
      const publicKey = ed25519.getPublicKey(seed);
      const message = randomBytes(48);

      const nativeSignature = candidate.ed25519Sign(seed, message);
      if (!ed25519.verify(nativeSignature, message, publicKey, { zip215: false })) {
        return fail('native signature rejected by the reference');
      }
      const reference = ed25519.sign(message, seed);
      if (!candidate.ed25519Verify(publicKey, message, reference)) {
        return fail('native verify rejected a valid signature');
      }
      const foreign = ed25519.getPublicKey(randomBytes(32));
      if (
        candidate.ed25519Verify(publicKey, message, flipped(reference)) ||
        candidate.ed25519Verify(publicKey, flipped(message), reference) ||
        candidate.ed25519Verify(foreign, message, reference) ||
        candidate.ed25519Verify(publicKey, message, malleate(reference))
      ) {
        return fail('native verify accepted an invalid signature');
      }

      const secret = randomBytes(32);
      const peerSecret = randomBytes(32);
      const peer = x25519.getPublicKey(peerSecret);
      if (
        !equalBytes(candidate.x25519PublicKey(secret), x25519.getPublicKey(secret)) ||
        !equalBytes(
          candidate.x25519SharedSecret(secret, peer),
          x25519.getSharedSecret(secret, peer),
        )
      ) {
        return fail('native X25519 differs from the reference');
      }
    }
  } catch {
    return fail('native primitive threw');
  }
  setNativeCurvePrimitives(candidate);
  return { active: true };
}

/** Back to the reference implementation (tests, or a misbehaving platform module). */
export function uninstallNativePrimitives(): void {
  setNativeCurvePrimitives(null);
}

export function curveBackend(): 'native' | 'reference' {
  return nativeCurvePrimitivesActive() ? 'native' : 'reference';
}
