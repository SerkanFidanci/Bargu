import { z } from 'zod';

import { AEAD_TAG_BYTES, base64urlOf, u32 } from './envelope.js';
import { placeEmojiSchema, placeNameSchema, timestamp } from './payload.js';

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

/**
 * Someone opened a story (docs/ADR/0035 Ek 1): its sender alone is told, so they see who saw it.
 * An older app does not know the kind and drops it whole.
 */
export const chatViewSchema = z
  .object({ kind: z.literal('view'), id: itemId, target: z.uuid(), ts: timestamp })
  .strict();

/** The quick reactions (docs/ADR/0035 Ek 2), the first given by a double tap. */
export const CHAT_REACTIONS = ['❤️', '😂', '😮', '😢', '🔥', '👍'] as const;
export type ChatReaction = (typeof CHAT_REACTIONS)[number];

/**
 * Someone reacted to an item (docs/ADR/0035 Ek 2), or took their reaction back (`emoji: null`): to
 * a conversation's item where that item went, to a story its sender alone. No notification. An older
 * app does not know the kind and drops it whole.
 */
export const chatReactSchema = z
  .object({
    kind: z.literal('react'),
    id: itemId,
    target: z.uuid(),
    emoji: z.enum(CHAT_REACTIONS).nullable(),
    ts: timestamp,
  })
  .strict();

/**
 * "Yakındayım, gelir misin?" (docs/ADR/0037): no place, no distance, nothing but that it was said;
 * the receiving phone works out how far from the location it already has. An older app does not
 * know the kind and drops it whole.
 */
export const chatNearSchema = z
  .object({ kind: z.literal('near'), id: itemId, ts: timestamp })
  .strict();

/**
 * "Herkes yerinde mi?" (docs/ADR/0040): an event owner's roll call, its id the roll call's. No words:
 * the phone writes the question. Sent through the roll call routes, never the chat.
 */
export const chatRollcallSchema = z
  .object({ kind: z.literal('rollcall'), id: itemId, closesAt: timestamp, ts: timestamp })
  .strict();

/** "Buradayım" to a roll call: who said it and when, and nothing of where (docs/ADR/0040 §2). */
export const chatHereSchema = z
  .object({ kind: z.literal('here'), id: itemId, rollcallId: z.uuid(), ts: timestamp })
  .strict();

/**
 * "Eve vardım kontrolü" (docs/ADR/0039): the numbers both sides keep. A check opens at most
 * `maxAheadMs` after it is set (so a one-shot check is over within a day), and a fired alert can be
 * opened for `openForMs` after its own due time and grace, however late the server or the phone.
 */
export const CHECKIN = {
  minAheadMs: 5 * 60_000,
  maxAheadMs: 23 * 3_600_000,
  openForMs: CHAT_LIFETIME_MS,
  graceMinutes: [5, 10, 15],
  noteMax: 140,
  maxRecipients: 5,
} as const;

/**
 * The sealed alert of an arrival check (docs/ADR/0039 §3), for one recipient's device: who it is
 * about comes from the signature. `due` and `grace` are signed, so a recipient can tell an alert
 * that came early. The place is its name only; the last location as the phone last had it.
 */
export const chatCheckinSchema = z
  .object({
    kind: z.literal('checkin'),
    id: itemId,
    due: timestamp,
    grace: z.union(CHECKIN.graceMinutes.map((minutes) => z.literal(minutes))),
    place: z.object({ name: placeNameSchema, emoji: placeEmojiSchema }).strict().nullable(),
    last: z
      .object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        acc: z.number().nonnegative().max(1_000_000),
        ts: timestamp,
      })
      .strict()
      .nullable(),
    bat: z.number().int().min(0).max(100).nullable(),
    chg: z.boolean().nullable(),
    note: textOf(CHECKIN.noteMax).optional(),
    /** Which refresh of the check this is: a recipient keeps the newest. */
    seq: z.number().int().nonnegative().max(1_000_000),
    ts: timestamp,
  })
  .strict();

/**
 * "Ali seni eve vardım kontrolüne ekledi · en geç 23:30" (docs/ADR/0039 §8): to each recipient when
 * a check is set, or for a repeated one when its plan is set or changed (`plan`: the days of the
 * week, 0 Sunday, and the time of day, as the owner's phone keeps it). No place, no location.
 */
export const chatCheckinSetSchema = z
  .object({
    kind: z.literal('checkinSet'),
    id: itemId,
    checkinId: z.uuid().nullable(),
    due: timestamp.nullable(),
    plan: z
      .object({
        days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
        at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      })
      .strict()
      .optional(),
    ts: timestamp,
  })
  .strict();

/**
 * "Ali vardı ✓" (docs/ADR/0039 §6, §8): a check ended well. Silent: it updates the recipient's
 * phone, no sound and no notification. `late`: the alert had already gone ("haber geç ulaştı").
 */
export const chatCheckinOkSchema = z
  .object({
    kind: z.literal('checkinOk'),
    id: itemId,
    checkinId: z.uuid(),
    late: z.boolean(),
    ts: timestamp,
  })
  .strict();

export const chatPayloadSchema = z.discriminatedUnion('kind', [
  chatTextSchema,
  chatPhotoSchema,
  chatDeleteSchema,
  chatShotSchema,
  chatViewSchema,
  chatReactSchema,
  chatNearSchema,
  chatRollcallSchema,
  chatHereSchema,
  chatCheckinSchema,
  chatCheckinSetSchema,
  chatCheckinOkSchema,
]);
export type ChatPayload = z.infer<typeof chatPayloadSchema>;
export type ChatPhoto = z.infer<typeof chatPhotoSchema>;
