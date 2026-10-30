import { z } from 'zod';

import { CHECKIN, directEnvelopeSchema } from './chat.js';
import { timestamp } from './payload.js';

/**
 * "Eve vardım kontrolü", the sealed escrow (docs/ADR/0039 §5). The owner's phone leaves one sealed
 * alert per recipient's device with the server and a time to open it; the server keeps it, never
 * reads it, and hands it over at that time unless the owner cancelled it first. These are the
 * limits it holds.
 */
export const CHECKIN_LIMITS = {
  /** Open (not yet fired) checks per person at once. */
  maxActive: 3,
  /** New checks per person in a day. */
  perDay: 10,
  /** A check takes one refresh in this long. */
  refreshGapMs: 2 * 60_000,
  /** A check can be extended this many times. */
  maxExtends: 5,
} as const;

/** One recipient's sealed alert: for their current device (`box.recipientDeviceId`). */
export const checkinBoxSchema = z
  .object({ recipientId: z.uuid(), box: directEnvelopeSchema })
  .strict();
export type CheckinBox = z.infer<typeof checkinBoxSchema>;

const boxes = z.array(checkinBoxSchema).min(1).max(CHECKIN.maxRecipients);

/** Set a check: its id (the alert's id inside every box), when to open it, the boxes. */
export const checkinCreateSchema = z.object({ id: z.uuid(), openAt: timestamp, boxes }).strict();
export type CheckinCreate = z.infer<typeof checkinCreateSchema>;

/** On the way: the same recipients' boxes, sealed again with the newest location. */
export const checkinRefreshSchema = z.object({ boxes }).strict();
export type CheckinRefresh = z.infer<typeof checkinRefreshSchema>;

/** Only the owner moves the time, with boxes sealed again for the new due time. */
export const checkinExtendSchema = z.object({ openAt: timestamp, boxes }).strict();
export type CheckinExtend = z.infer<typeof checkinExtendSchema>;

/** Refusals a phone can act on. `RECIPIENT` never says why (blocked, no shared circle, gone). */
export const CHECKIN_REFUSALS = [
  'INVALID',
  'TIME',
  'TOO_MANY',
  'DAILY_LIMIT',
  'RECIPIENT',
  'RATE_LIMITED',
  'FIRED',
  'EXTENDS',
  'NOT_FOUND',
] as const;
export type CheckinRefusal = (typeof CHECKIN_REFUSALS)[number];

export const checkinReplySchema = z.union([
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ refused: z.enum(CHECKIN_REFUSALS) }).strict(),
]);
export type CheckinReply = z.infer<typeof checkinReplySchema>;

/** The owner's own checks: to cancel after a reinstall, and to see which already fired. */
export const checkinListSchema = z
  .object({
    checkins: z
      .array(
        z
          .object({
            id: z.uuid(),
            openAt: timestamp,
            firedAt: timestamp.nullable(),
            recipients: z.array(z.uuid()).max(CHECKIN.maxRecipients),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type CheckinList = z.infer<typeof checkinListSchema>;

/** Alerts handed over to this person (fired, not yet seen): their own box only. */
export const checkinInboxSchema = z
  .object({
    alerts: z
      .array(
        z
          .object({
            checkinId: z.uuid(),
            ownerId: z.uuid(),
            firedAt: timestamp,
            box: directEnvelopeSchema,
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type CheckinInbox = z.infer<typeof checkinInboxSchema>;
