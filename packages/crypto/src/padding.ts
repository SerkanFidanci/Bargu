import { PADDING_BLOCK_BYTES } from './constants.js';
import { BarguCryptoError } from './errors.js';

/**
 * ISO/IEC 7816-4 padding: append 0x80 then zeros up to the next multiple of the block size. Hides
 * the exact plaintext length (e.g. status text length) from anyone who sees the ciphertext.
 */
export function pad(data: Uint8Array, maxPaddedLength: number): Uint8Array {
  const paddedLength = Math.ceil((data.length + 1) / PADDING_BLOCK_BYTES) * PADDING_BLOCK_BYTES;
  if (paddedLength > maxPaddedLength) {
    throw new BarguCryptoError('PAYLOAD_TOO_LARGE', 'plaintext exceeds the size limit');
  }
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  return padded;
}

export function unpad(padded: Uint8Array): Uint8Array {
  if (padded.length === 0 || padded.length % PADDING_BLOCK_BYTES !== 0) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'invalid padding');
  }
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0x00) end--;
  if (end < 0 || padded[end] !== 0x80) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'invalid padding');
  }
  return padded.slice(0, end);
}
