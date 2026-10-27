import { z } from 'zod';

import { AEAD_TAG_BYTES, base64urlOf, u32 } from './envelope.js';
import { timestamp } from './payload.js';

/**
 * Messages and moments (docs/ADR/0035): what a circle or one person is sent, gone 24 hours later.
 * Plaintexts are padded to the smaller of these that fits, so only "short or long" shows.
 */
export const CHAT_PADDED_SIZES = [1024, 8192] as const;

/** Everything is deleted this long after it was sent: on the server and on every phone. */
export const CHAT_LIFETIME_MS = 24 * 60 * 60 * 1000;

/** A text: 1 to this many characters (code points, so an emoji counts once). */
export const CHAT_TEXT_MAX = 1000;
export const CHAT_CAPTION_MAX = 200;

/** A sealed photo file: what the server takes (docs/ADR/0035 §4, §10). */
export const CHAT_PHOTO_MAX_BYTES = 600 * 1024;
/** The longer side of a photo after the phone resizes it. */
export const CHAT_PHOTO_MAX_SIDE = 1600;

const ctOfChat = z.union([
  base64urlOf(CHAT_PADDED_SIZES[0] + AEAD_TAG_BYTES),
  base64urlOf(CHAT_PADDED_SIZES[1] + AEAD_TAG_BYTES),
]);

/**
 * An item for a whole circle (docs/ADR/0035 §2): sealed with a chat key derived from the sender's
 * sender key, named by a random `id`, and carrying `commit`, the SHA-256 of its own key and nonce,
 * which the signature covers (a report can prove which key opens it).
 */
export const chatEnvelopeSchema = z
  .object({
    v: z.literal(1),
    circleId: z.uuid(),
    epoch: u32,
    senderDeviceId: z.uuid(),
    id: z.uuid(),
    salt: base64urlOf(16),
    commit: base64urlOf(32),
    ct: ctOfChat,
    sig: base64urlOf(64),
  })
  .strict();
export type ChatEnvelope = z.infer<typeof chatEnvelopeSchema>;

/**
 * An item for one person (docs/ADR/0035 §3): sealed to their device with a fresh X25519 key, the
 * same way a sender key is distributed, with its own key commitment.
 */
export const directEnvelopeSchema = z
  .object({
    v: z.literal(1),
    senderDeviceId: z.uuid(),
    recipientDeviceId: z.uuid(),
    id: z.uuid(),
    ephemeralKey: base64urlOf(32),
    commit: base64urlOf(32),
    ct: ctOfChat,
    sig: base64urlOf(64),
  })
  .strict();
export type DirectEnvelope = z.infer<typeof directEnvelopeSchema>;

/** Characters as people count them: code points (an emoji once), not UTF-16 units. */
export function codePointsOf(text: string): number {
  return Array.from(text.matchAll(/./gsu)).length;
}

const textOf = (max: number) =>
  z.string().refine((text) => codePointsOf(text) <= max && text.trim().length > 0);

const itemId = z.uuid();

export const chatTextSchema = z
  .object({
    kind: z.literal('text'),
    id: itemId,
    text: textOf(CHAT_TEXT_MAX),
    /** The item or story this answers. */
    replyTo: z.uuid().optional(),
    ts: timestamp,
  })
  .strict();

export const chatPhotoSchema = z
  .object({
    kind: z.literal('photo'),
    id: itemId,
    blobId: z.uuid(),
    /** The file's own one-time key (docs/ADR/0035 §4). */
    key: base64urlOf(32),
    /** The sealed file's size and SHA-256: the file is bound to this signed item. */
    size: z.number().int().min(1).max(CHAT_PHOTO_MAX_BYTES),
    hash: base64urlOf(32),
    w: z.number().int().min(1).max(CHAT_PHOTO_MAX_SIDE),
    h: z.number().int().min(1).max(CHAT_PHOTO_MAX_SIDE),
    caption: textOf(CHAT_CAPTION_MAX).optional(),
    /** A story (a ring on the sender's pin) rather than an item of the conversation. */
    story: z.boolean(),
    ts: timestamp,
  })
  .strict();

/** The sender takes an item of theirs back from everyone. */
export const chatDeleteSchema = z
  .object({ kind: z.literal('del'), id: itemId, target: z.uuid(), ts: timestamp })
  .strict();

/** Someone took a screenshot of a photo (Android 14+; docs/ADR/0035 §12). */
export const chatShotSchema = z
  .object({ kind: z.literal('shot'), id: itemId, target: z.uuid(), ts: timestamp })
  .strict();

export const chatPayloadSchema = z.discriminatedUnion('kind', [
  chatTextSchema,
  chatPhotoSchema,
  chatDeleteSchema,
  chatShotSchema,
]);
export type ChatPayload = z.infer<typeof chatPayloadSchema>;
export type ChatPhoto = z.infer<typeof chatPhotoSchema>;
