import { MAX_MESSAGE_PLAINTEXT_BYTES } from '@bargu/schemas';

/** Wire format version carried in every header (`v`). */
export const PROTOCOL_VERSION = 1;

export const KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const SALT_BYTES = 16;
export const ID_BYTES = 16;

/** Plaintexts are padded to a multiple of this, so ciphertext length reveals little. */
export const PADDING_BLOCK_BYTES = 128;
export const MAX_MESSAGE_PADDED_BYTES = MAX_MESSAGE_PLAINTEXT_BYTES;
/** Push providers cap payloads at 4 KB; the sealed box must fit after base64url. */
export const MAX_PUSH_PADDED_BYTES = 2048;

export const SAFETY_NUMBER_ITERATIONS = 5200;
/** Sender keys rotate at least this often (BARGU_PLAN §3.1, "her 24 saatte bir"). */
export const REKEY_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** Largest value of the u32 fields `epoch` and `seq`. */
export const MAX_U32 = 0xffff_ffff;

/**
 * Domain-separation labels. Each is encoded as UTF-8 followed by a 0x00 byte, so no label can be
 * a prefix of another and every signature / KDF context is bound to exactly one purpose.
 */
export const LABELS = {
  dhKeySignature: 'bargu/v1/dh-key',
  senderKeyDistributionKdf: 'bargu/v1/skd',
  senderKeyDistributionSignature: 'bargu/v1/skd-sig',
  messageKdf: 'bargu/v1/msg',
  messageSignature: 'bargu/v1/msg-sig',
  pushKdf: 'bargu/v1/push',
  safetyNumber: 'bargu/v1/safety',
} as const;

export type Label = (typeof LABELS)[keyof typeof LABELS];
