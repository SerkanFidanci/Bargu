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
function* fingerprintSteps(
  { userId, identityKey }: SafetyNumberParty,
  roundsPerStep: number,
): Generator<void, Uint8Array> {
  if (identityKey.length !== KEY_BYTES) {
    throw new BarguCryptoError('INVALID_KEY', 'identity key must be 32 bytes');
  }
  let hash = sha256Hash(
    concatBytes(labelBytes(LABELS.safetyNumber), uuidToBytes(userId), identityKey),
  );
  for (let i = 1; i <= SAFETY_NUMBER_ITERATIONS; i++) {
    hash = sha256Hash(concatBytes(hash, identityKey));
    if (i % roundsPerStep === 0) yield;
  }
  return hash.slice(0, FINGERPRINT_BYTES);
}

function fingerprint(party: SafetyNumberParty): Uint8Array {
  const steps = fingerprintSteps(party, SAFETY_NUMBER_ITERATIONS);
  for (let step = steps.next(); ; step = steps.next()) {
    if (step.done === true) return step.value;
  }
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
  assertTwoUsers(a, b);
  return combine(fingerprint(a), fingerprint(b));
}

/** Rounds of hashing between two pauses of safetyNumberAsync (about 1–2 ms each on a phone). */
export const SAFETY_NUMBER_ROUNDS_PER_PAUSE = 200;

/**
 * The same number without blocking the app: the 2 × 5200 hash rounds run in short slices with a
 * pause (`pause`, e.g. one animation frame) between them, so the screen keeps animating.
 */
export async function safetyNumberAsync(
  a: SafetyNumberParty,
  b: SafetyNumberParty,
  pause: () => Promise<void>,
): Promise<SafetyNumber> {
  assertTwoUsers(a, b);
  const fingerprints: Uint8Array[] = [];
  for (const party of [a, b]) {
    const steps = fingerprintSteps(party, SAFETY_NUMBER_ROUNDS_PER_PAUSE);
    for (let step = steps.next(); ; step = steps.next()) {
      if (step.done === true) {
        fingerprints.push(step.value);
        break;
      }
      await pause();
    }
  }
  const [first, second] = fingerprints as [Uint8Array, Uint8Array];
  return combine(first, second);
}

function assertTwoUsers(a: SafetyNumberParty, b: SafetyNumberParty): void {
  if (a.userId === b.userId) {
    throw new BarguCryptoError('MALFORMED', 'a safety number needs two different users');
  }
}

function combine(fpA: Uint8Array, fpB: Uint8Array): SafetyNumber {
  // Order by the full fingerprint so both phones agree on the order even in the (astronomically
  // unlikely) case of equal digits. Fingerprints of different user ids never coincide.
  const parts = [fpA, fpB]
    .map((fp) => ({ fp, hex: bytesToHex(fp), digits: toDigits(fp) }))
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

/**
 * Compares a scanned QR payload with a safety number already computed (e.g. by safetyNumberAsync),
 * in constant time, without hashing everything again on the UI thread.
 */
export function safetyNumberQrMatches(scanned: string, number: SafetyNumber): boolean {
  return equalBytes(utf8Encode(scanned), utf8Encode(number.qr));
}
