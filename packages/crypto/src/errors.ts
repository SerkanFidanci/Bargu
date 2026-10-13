export type CryptoErrorCode =
  /** Input does not match the wire format (schema, encoding, lengths). */
  | 'MALFORMED'
  /** A key is not a valid curve point / has the wrong size / is low-order. */
  | 'INVALID_KEY'
  | 'BAD_SIGNATURE'
  /** Authentication tag mismatch or bad padding: wrong key or tampered ciphertext. */
  | 'DECRYPT_FAILED'
  /** The envelope was produced for another circle, epoch or sender than the key supplied. */
  | 'KEY_MISMATCH'
  | 'WRONG_RECIPIENT'
  /** Message already accepted, outside the replay window, or from an epoch below the floor. */
  | 'REPLAY'
  /** Authentic location that is older than one already accepted (locations are last-write-wins). */
  | 'STALE'
  | 'PAYLOAD_TOO_LARGE'
  /** The sender key ran out of sequence numbers; a new epoch is required. */
  | 'REKEY_REQUIRED';

/**
 * The only error type the public API throws. Messages describe what failed, never key material or
 * plaintext.
 */
export class BarguCryptoError extends Error {
  override readonly name = 'BarguCryptoError';

  constructor(
    readonly code: CryptoErrorCode,
    message: string,
  ) {
    super(message);
  }
}
