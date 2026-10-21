import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base64urlnopad } from '@scure/base';

import { ID_BYTES, MAX_U32 } from './constants.js';
import { BarguCryptoError } from './errors.js';

export { concatBytes } from '@noble/hashes/utils.js';

export function toBase64url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}

/**
 * Strict base64url (no padding) decoding. @scure/base rejects padding, foreign alphabets and
 * non-zero trailing bits, so every byte string has exactly one accepted textual form. Checks the
 * decoded length when `length` is given.
 */
export function fromBase64url(text: string, length?: number): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = base64urlnopad.decode(text);
  } catch {
    throw new BarguCryptoError('MALFORMED', 'invalid base64url');
  }
  if (length !== undefined && bytes.length !== length) {
    throw new BarguCryptoError('MALFORMED', `expected ${String(length)} bytes`);
  }
  return bytes;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Canonical (lower-case, hyphenated) UUID to its 16 raw bytes. */
export function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_PATTERN.test(uuid)) {
    throw new BarguCryptoError('MALFORMED', 'invalid id');
  }
  const hex = uuid.replaceAll('-', '');
  const bytes = new Uint8Array(ID_BYTES);
  for (let i = 0; i < ID_BYTES; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 16 raw bytes back to the canonical UUID text. */
export function bytesToUuid(bytes: Uint8Array): string {
  if (bytes.length !== ID_BYTES) throw new BarguCryptoError('MALFORMED', 'invalid id');
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function u32be(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > MAX_U32) {
    throw new BarguCryptoError('MALFORMED', 'expected an unsigned 32-bit integer');
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  return bytes;
}

/** A whole number of milliseconds as 8 big-endian bytes (no BigInt: Hermes and Node alike). */
export function u64be(value: number): Uint8Array {
  return concatBytes(u32be(Math.floor(value / 0x1_0000_0000)), u32be(value % 0x1_0000_0000));
}

/** The first 8 bytes, big-endian, as a whole number; above Number.MAX_SAFE_INTEGER is MALFORMED. */
export function readU64be(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
  const high = view.getUint32(0, false);
  if (high > 0x1f_ffff) throw new BarguCryptoError('MALFORMED', 'number too large');
  return high * 0x1_0000_0000 + view.getUint32(4, false);
}

/** Text known to be ASCII (an id its schema bounds) as bytes, one per character. */
export function asciiBytes(text: string): Uint8Array {
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** A domain-separation label as bytes: UTF-8 followed by a 0x00 terminator. */
export function labelBytes(label: string): Uint8Array {
  const text = utf8ToBytes(label);
  const bytes = new Uint8Array(text.length + 1);
  bytes.set(text);
  return bytes;
}

export function utf8Encode(text: string): Uint8Array {
  return utf8ToBytes(text);
}

const decoder = new TextDecoder('utf-8', { fatal: true });

export function utf8Decode(bytes: Uint8Array): string {
  try {
    return decoder.decode(bytes);
  } catch {
    throw new BarguCryptoError('MALFORMED', 'invalid UTF-8');
  }
}
