import { BarguCryptoError } from './errors.js';

/**
 * ISO/IEC 7816-4 padding: append 0x80 then zeros up to the next multiple of `blockBytes`. Hides
 * the exact plaintext length from anyone who sees the ciphertext. With `blockBytes` equal to
 * `maxPaddedLength` every output has the same size.
 */
export function pad(data: Uint8Array, blockBytes: number, maxPaddedLength: number): Uint8Array {
  const paddedLength = Math.ceil((data.length + 1) / blockBytes) * blockBytes;
  if (paddedLength > maxPaddedLength) {
    throw new BarguCryptoError('PAYLOAD_TOO_LARGE', 'plaintext exceeds the size limit');
  }
  const padded = new Uint8Array(paddedLength);
  padded.set(data);
  padded[data.length] = 0x80;
  return padded;
}

/** Reverses `pad`. Runs only on authenticated plaintext, so its errors are not a padding oracle. */
export function unpad(padded: Uint8Array, blockBytes: number): Uint8Array {
  if (padded.length === 0 || padded.length % blockBytes !== 0) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'invalid padding');
  }
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0x00) end--;
  if (end < 0 || padded[end] !== 0x80) {
    throw new BarguCryptoError('DECRYPT_FAILED', 'invalid padding');
  }
  return padded.slice(0, end);
}
