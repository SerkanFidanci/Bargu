import { equalBytes } from '@noble/ciphers/utils.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import { KEY_BYTES, LABELS, SAFETY_NUMBER_ITERATIONS } from './constants.js';
import { concatBytes, labelBytes, toBase64url, utf8Encode, uuidToBytes } from './encoding.js';
import { BarguCryptoError } from './errors.js';
import { sha256Hash } from './primitives.js';

export interface SafetyNumberParty {
  readonly userId: string;
  /** The user's current device identity key (Ed25519 public key). */
  readonly identityKey: Uint8Array;
}

export interface SafetyNumber {
  /** 60 digits; identical on both phones. */
  readonly digits: string;
  /** The same digits as 12 groups of 5 for display. */
  readonly groups: readonly string[];
  /** QR payload; scanning the other phone's code and comparing proves there is no MITM. */
  readonly qr: string;
}

const FINGERPRINT_BYTES = 30;
const QR_PREFIX = 'bargu-sn:1:';

/**
 * Iterated SHA-256 over (label ‖ userId ‖ identityKey), re-mixing the key each round (as Signal
 * does with SHA-512). The work factor makes searching for a colliding key even less practical.
 */
function fingerprint({ userId, identityKey }: SafetyNumberParty): Uint8Array {
  if (identityKey.length !== KEY_BYTES) {
    throw new BarguCryptoError('INVALID_KEY', 'identity key must be 32 bytes');
  }
  let hash = sha256Hash(
    concatBytes(labelBytes(LABELS.safetyNumber), uuidToBytes(userId), identityKey),
  );
  for (let i = 0; i < SAFETY_NUMBER_ITERATIONS; i++) {
    hash = sha256Hash(concatBytes(hash, identityKey));
  }
  return hash.slice(0, FINGERPRINT_BYTES);
}

/** Six 5-digit chunks: each 5-byte big-endian chunk modulo 100000. */
function toDigits(fp: Uint8Array): string {
  let digits = '';
  for (let offset = 0; offset < FINGERPRINT_BYTES; offset += 5) {
    const value = fp.subarray(offset, offset + 5).reduce((acc, byte) => acc * 256 + byte, 0);
    digits += String(value % 100_000).padStart(5, '0');
  }
  return digits;
}

/**
 * Safety number for a pair of users (BARGU_PLAN §3.1). It changes whenever either identity key
 * changes, which the app surfaces as a "security number changed" warning in shared circles.
 */
export function safetyNumber(a: SafetyNumberParty, b: SafetyNumberParty): SafetyNumber {
  if (a.userId === b.userId) {
    throw new BarguCryptoError('MALFORMED', 'a safety number needs two different users');
  }
  // Order by the full fingerprint so both phones agree on the order even in the (astronomically
  // unlikely) case of equal digits. Fingerprints of different user ids never coincide.
  const parts = [a, b]
    .map((party) => {
      const fp = fingerprint(party);
      return { fp, hex: bytesToHex(fp), digits: toDigits(fp) };
    })
    .sort((x, y) => (x.hex < y.hex ? -1 : 1));
  const [first, second] = parts as [(typeof parts)[number], (typeof parts)[number]];
  const digits = first.digits + second.digits;
  return {
    digits,
    groups: Array.from({ length: digits.length / 5 }, (_, i) => digits.slice(i * 5, i * 5 + 5)),
    qr: QR_PREFIX + toBase64url(concatBytes(first.fp, second.fp)),
  };
}

/** Compares a scanned QR payload with the locally computed one in constant time. */
export function verifySafetyNumberQr(
  scanned: string,
  a: SafetyNumberParty,
  b: SafetyNumberParty,
): boolean {
  return equalBytes(utf8Encode(scanned), utf8Encode(safetyNumber(a, b).qr));
}
