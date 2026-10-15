// Account helpers shared by the app and the API (Faz 2, docs/PROTOCOL.md §12). They reuse the same
// audited primitives and labels as the E2EE protocol but are not part of the message wire format.
import { equalBytes } from '@noble/ciphers/utils.js';

import { KEY_BYTES, type Label, LABELS, SIGNATURE_BYTES } from './constants.js';
import {
  concatBytes,
  fromBase64url,
  labelBytes,
  toBase64url,
  utf8Encode,
  uuidToBytes,
} from './encoding.js';
import { BarguCryptoError } from './errors.js';
import {
  hmacWithLabel,
  randomBytes,
  sha256Hash,
  signWithLabel,
  verifyWithLabel,
} from './primitives.js';

/** Accepted clock difference between a signed request and the server. */
export const REQUEST_MAX_SKEW_MS = 60_000;
export const REQUEST_NONCE_BYTES = 16;
const MAX_PATH_BYTES = 2048;
const METHOD_PATTERN = /^[A-Z]{1,16}$/;

/** What a device signs for a sensitive API request (BARGU_PLAN §3.2, "istek imzalama"). */
export interface RequestToSign {
  /** HTTP method, upper case. */
  method: string;
  /** Path and query string exactly as sent, starting with `/`. */
  path: string;
  /** Unix epoch milliseconds. */
  timestamp: number;
  /** 16 random bytes, base64url; the server accepts each nonce once. */
  nonce: string;
  deviceId: string;
  /** Raw request body (empty for none). */
  body: Uint8Array;
}

function requestMessage(request: RequestToSign): Uint8Array {
  if (!METHOD_PATTERN.test(request.method)) {
    throw new BarguCryptoError('MALFORMED', 'invalid method');
  }
  const path = utf8Encode(request.path);
  if (!request.path.startsWith('/') || path.length > MAX_PATH_BYTES) {
    throw new BarguCryptoError('MALFORMED', 'invalid path');
  }
  if (!Number.isSafeInteger(request.timestamp) || request.timestamp < 0) {
    throw new BarguCryptoError('MALFORMED', 'invalid timestamp');
  }
  const header = new Uint8Array(1 + request.method.length + 2);
  header[0] = request.method.length;
  header.set(utf8Encode(request.method), 1);
  new DataView(header.buffer).setUint16(1 + request.method.length, path.length, false);
  // u64 big-endian as two u32 halves (no BigInt needed on Hermes).
  const timestamp = new Uint8Array(8);
  const view = new DataView(timestamp.buffer);
  view.setUint32(0, Math.floor(request.timestamp / 2 ** 32), false);
  view.setUint32(4, request.timestamp % 2 ** 32, false);
  // method(u8 len ‖ ASCII) ‖ path(u16 len ‖ UTF-8) ‖ ts(u64) ‖ nonce(16) ‖ deviceId(16) ‖ sha256(body)
  return concatBytes(
    header,
    path,
    timestamp,
    fromBase64url(request.nonce, REQUEST_NONCE_BYTES),
    uuidToBytes(request.deviceId),
    sha256Hash(request.body),
  );
}

export function generateRequestNonce(): string {
  return toBase64url(randomBytes(REQUEST_NONCE_BYTES));
}

/** Ed25519 signature by the device identity key, base64url (header `x-bargu-sig`). */
export function signRequest(identitySecretKey: Uint8Array, request: RequestToSign): string {
  return toBase64url(
    signWithLabel(LABELS.requestSignature, requestMessage(request), identitySecretKey),
  );
}

/**
 * Checks the signature only; the caller checks the clock window and that the nonce is new.
 * Malformed input of any kind yields `false`.
 */
export function verifyRequestSignature(
  identityPublicKey: Uint8Array,
  request: RequestToSign,
  signature: string,
): boolean {
  try {
    return verifyWithLabel(
      LABELS.requestSignature,
      requestMessage(request),
      fromBase64url(signature, SIGNATURE_BYTES),
      identityPublicKey,
    );
  } catch {
    return false;
  }
}

/**
 * 4 digits (docs/ADR/0012, a product decision): 10^4 codes, so guessing is held back by the
 * attempt budgets in apps/api otp.service (3 per code, 10 a day and 20 a week per address).
 */
export const OTP_DIGITS = 4;

function requireKey(key: Uint8Array): void {
  if (key.length !== KEY_BYTES) throw new BarguCryptoError('INVALID_KEY', 'expected a 32-byte key');
}

/**
 * 8 digits for the account web page (docs/ADR/0021): typed from an email on a computer, so length
 * costs little, and 10^8 codes make guessing hopeless within its small attempt budgets.
 */
export const WEB_CODE_DIGITS = 8;

/** A code derived from the challenge id (HOTP-style, RFC 4226, with HMAC-SHA256). */
function deriveCode(key: Uint8Array, label: Label, challengeId: string, digits: number): string {
  requireKey(key);
  const mac = hmacWithLabel(key, label, uuidToBytes(challengeId));
  let value = 0;
  for (const byte of mac.subarray(0, 6)) value = value * 256 + byte;
  mac.fill(0);
  return String(value % 10 ** digits).padStart(digits, '0');
}

function codeMatches(expected: string, code: string): boolean {
  const want = utf8Encode(expected);
  const given = utf8Encode(code);
  return given.length === want.length && equalBytes(given, want);
}

/**
 * The one-time code for a login challenge, derived instead of stored (HOTP-style, RFC 4226, with
 * HMAC-SHA256 and the challenge id as the moving factor). Neither the database nor the job queue
 * ever holds a code or a hash of one; without the server key a leaked challenge reveals nothing.
 * 48 bits reduced mod 10^4: bias below 10^-10.
 */
export function deriveOtpCode(otpKey: Uint8Array, challengeId: string): string {
  return deriveCode(otpKey, LABELS.otpCode, challengeId, OTP_DIGITS);
}

/** Constant-time check of a submitted code. */
export function verifyOtpCode(otpKey: Uint8Array, challengeId: string, code: string): boolean {
  return codeMatches(deriveOtpCode(otpKey, challengeId), code);
}

/**
 * The account web page's code (docs/ADR/0021), derived like the login code under its own label:
 * one is never valid as the other. 48 bits reduced mod 10^8: bias below 10^-6.
 */
export function deriveWebCode(otpKey: Uint8Array, challengeId: string): string {
  return deriveCode(otpKey, LABELS.webCode, challengeId, WEB_CODE_DIGITS);
}

/** Constant-time check of a code typed into the account web page. */
export function verifyWebCode(otpKey: Uint8Array, challengeId: string, code: string): boolean {
  return codeMatches(deriveWebCode(otpKey, challengeId), code);
}

/** Canonical form used for lookups: trimmed, Unicode NFC, lower case. */
export function normalizeEmail(email: string): string {
  return email.trim().normalize('NFC').toLowerCase();
}

/**
 * Keyed hash of an email address. The server stores only this (data minimisation): it can find an
 * account by the address the user types, but a database leak without the key reveals no addresses.
 */
export function emailLookupKey(lookupKey: Uint8Array, email: string): Uint8Array {
  requireKey(lookupKey);
  return hmacWithLabel(lookupKey, LABELS.emailLookup, utf8Encode(normalizeEmail(email)));
}

/**
 * Stable pseudonym for a value that must not be stored in clear, such as a client IP in a rate-limit
 * key: keyed (a plain hash of an IPv4 address is reversible by enumeration) and separated by
 * purpose. 128 bits, hex.
 */
export function pseudonym(key: Uint8Array, purpose: string, value: string): string {
  requireKey(key);
  const mac = hmacWithLabel(
    key,
    LABELS.pseudonym,
    concatBytes(labelBytes(purpose), utf8Encode(value)),
  );
  return Array.from(mac.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 256-bit random bearer secret (refresh tokens), base64url. */
export function generateToken(): string {
  return toBase64url(randomBytes(KEY_BYTES));
}

/** What the server stores for a high-entropy token: SHA-256 with a domain label. */
export function hashToken(token: string): Uint8Array {
  return sha256Hash(concatBytes(labelBytes(LABELS.tokenHash), utf8Encode(token)));
}
