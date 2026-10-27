import { z } from 'zod';

import {
  CHAT_PHOTO_MAX_BYTES,
  chatEnvelopeSchema,
  directEnvelopeSchema,
  type ChatEnvelope,
  type DirectEnvelope,
} from './chat.js';
import { base64urlOf } from './envelope.js';
import { timestamp } from './payload.js';
import { devicePushesSchema } from './push.js';

// The server side of messages and moments (docs/ADR/0035 §6): what phones send and get back.

/** Why the server did not take an item. The item is not stored and goes nowhere. */
export const CHAT_REFUSALS = [
  // Not signed by the caller's device, or not addressed as its route says.
  'INVALID',
  // Not an active member of the circle, or no circle shared with the person.
  'NOT_MEMBER',
  // Sealed with an epoch the circle is not in (the phone fetches the circle again).
  'EPOCH',
  'RATE_LIMITED',
  // The day's allowance of items or photos is used up (500 and 50 a day).
  'DAILY_LIMIT',
] as const;
export type ChatRefusal = (typeof CHAT_REFUSALS)[number];

/** An item for a circle, with the photo it shares (uploaded first) and sealed notifications. */
export const chatCircleRequestSchema = z
  .object({
    envelope: chatEnvelopeSchema,
    blobId: z.uuid().optional(),
    pushes: devicePushesSchema.optional(),
  })
  .strict();

/** An item for one person, the same way. */
export const chatDirectRequestSchema = z
  .object({
    envelope: directEnvelopeSchema,
    blobId: z.uuid().optional(),
    pushes: devicePushesSchema.optional(),
  })
  .strict();

export const chatSendReplySchema = z
  .object({ ok: z.literal(true) })
  .strict()
  .or(z.object({ refused: z.enum(CHAT_REFUSALS) }).strict());
export type ChatSendReply = z.infer<typeof chatSendReplySchema>;

/** An item as phones get it: live (`chat`) or from the list after being away. */
export const chatRecordSchema = z
  .object({
    id: z.uuid(),
    senderId: z.uuid(),
    /** One of the two: the circle it was sent to, or the person. */
    circleId: z.uuid().nullable(),
    recipientId: z.uuid().nullable(),
    envelope: z.union([chatEnvelopeSchema, directEnvelopeSchema]),
    blobId: z.uuid().nullable(),
    /** When the server took it: the list's cursor, and the start of its 24 hours. */
    at: timestamp,
  })
  .strict();
export type ChatRecord = Omit<z.infer<typeof chatRecordSchema>, 'envelope'> & {
  envelope: ChatEnvelope | DirectEnvelope;
};

/** Items taken after `after` (Unix ms), oldest first; at most CHAT_LIST_MAX at a time. */
export const chatListQuerySchema = z.object({ after: z.coerce.number().int().min(0) }).strict();
export const CHAT_LIST_MAX = 500;
export const chatListSchema = z.object({ items: z.array(chatRecordSchema) }).strict();

/** The live event when an item is taken back or its event ended. */
export const chatGoneEventSchema = z.object({ id: z.uuid() }).strict();
export const chatEventSchema = z.object({ item: chatRecordSchema }).strict();

/** A sealed photo file (packages/crypto `sealChatPhoto`), as base64url. */
const sealedFile = z
  .string()
  .min(83)
  .max(Math.ceil((CHAT_PHOTO_MAX_BYTES * 4) / 3))
  .regex(/^[A-Za-z0-9_-]*$/);
export const mediaUploadSchema = z.object({ id: z.uuid(), bytes: sealedFile }).strict();
export const mediaSchema = z.object({ id: z.uuid(), bytes: sealedFile }).strict();
export type Media = z.infer<typeof mediaSchema>;

/** Why someone reports an item or a person (docs/ADR/0035 §9). */
export const REPORT_REASONS = [
  'spam',
  'harassment',
  'sexual',
  'child',
  'violence',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
/** Reports that are kept until the owner closes them (child abuse); the others 90 days. */
export const REPORT_KEEP_DAYS = 90;

/**
 * A report: of a person, or of one of their items with that item's own key and nonce (never a
 * circle's or a person's key). A photo's sealed file comes along when the server may no longer
 * have it (the sender took the item back).
 */
export const reportRequestSchema = z
  .object({
    userId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    item: z
      .object({
        envelope: z.union([chatEnvelopeSchema, directEnvelopeSchema]),
        key: base64urlOf(32),
        nonce: base64urlOf(12),
      })
      .strict()
      .optional(),
    file: sealedFile.optional(),
  })
  .strict();
export type ReportRequest = z.infer<typeof reportRequestSchema>;

/** The people the caller blocked (only theirs; nobody learns they were blocked). */
export const blockListSchema = z.object({ blocked: z.array(z.uuid()) }).strict();
