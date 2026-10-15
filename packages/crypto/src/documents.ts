import { LABELS } from './constants.js';
import { bytesToUuid, concatBytes, labelBytes, uuidToBytes } from './encoding.js';
import { sha256Hash } from './primitives.js';

/**
 * The id of a member's vote in a poll (docs/ADR/0018): the same on each of their phones, so a new
 * phone replaces the old phone's vote instead of adding a second one, and every member can check
 * that a vote is filed under the person who signed it. A version 8 UUID (RFC 9562) from
 * SHA-256(label ‖ pollId ‖ userId).
 */
export function voteId(pollId: string, userId: string): string {
  const digest = sha256Hash(
    concatBytes(labelBytes(LABELS.voteId), uuidToBytes(pollId), uuidToBytes(userId)),
  );
  // Version nibble 8 in byte 6, variant bits 10 in byte 8.
  return bytesToUuid(
    Uint8Array.from(digest.subarray(0, 16), (byte, index) =>
      index === 6 ? (byte & 0x0f) | 0x80 : index === 8 ? (byte & 0x3f) | 0x80 : byte,
    ),
  );
}
