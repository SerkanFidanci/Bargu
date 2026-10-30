import { z } from 'zod';

import { chatEnvelopeSchema } from './chat.js';
import { MAX_CIRCLE_MEMBERS } from './circles.js';
import { timestamp } from './payload.js';
import { devicePushesSchema } from './push.js';

/**
 * "Herkes yerinde mi?" (docs/ADR/0040): an event's owner asks, members say "Buradayım" with one tap,
 * and it closes after ten minutes. The question and the answers are small items sealed with the
 * circle's chat key (encryptChat): the server keeps them apart from the chat so it can hold the
 * rules (owners only, one at a time, ten minutes, who may answer) and so it sees who answered
 * which roll call when (docs/THREAT_MODEL.md, accepted). An answer carries no location.
 */
export const ROLLCALL = {
  /** A roll call is open this long. */
  openMs: 10 * 60_000,
  /** Roll calls a circle may have in an hour (so an owner cannot flood the members). */
  perHour: 6,
  /** 15–17 take part only in circles of at most this many members (the PM, ADR 0040). */
  teenMaxMembers: 8,
  /** A roll call and its answers are deleted this long after it began (or with the event). */
  keepMs: 24 * 3_600_000,
} as const;

/** Starting one: its id is the item's id; the owner's phone sealed the members' notifications. */
export const rollcallStartSchema = z
  .object({
    envelope: chatEnvelopeSchema,
    pushes: devicePushesSchema.optional(),
  })
  .strict();
export type RollcallStart = z.infer<typeof rollcallStartSchema>;

/** "Buradayım": a sealed `here` item for the roll call. */
export const rollcallAnswerSchema = z.object({ envelope: chatEnvelopeSchema }).strict();
export type RollcallAnswer = z.infer<typeof rollcallAnswerSchema>;

export const rollcallSchema = z
  .object({
    id: z.uuid(),
    circleId: z.uuid(),
    startedBy: z.uuid(),
    startedAt: timestamp,
    closesAt: timestamp,
    /** Set when it closed (its ten minutes, or an owner said "Bitir"). */
    closedAt: timestamp.nullable(),
    /** Who may answer, fixed when it began (docs/ADR/0040 §4). */
    eligible: z.array(z.uuid()).max(MAX_CIRCLE_MEMBERS),
    /** Members who are not in it; never why (an old app, the setting off, or 15–17). */
    outCount: z.number().int().nonnegative().max(MAX_CIRCLE_MEMBERS),
    envelope: chatEnvelopeSchema,
    answers: z
      .array(z.object({ userId: z.uuid(), at: timestamp, envelope: chatEnvelopeSchema }).strict())
      .max(MAX_CIRCLE_MEMBERS),
  })
  .strict();
export type Rollcall = z.infer<typeof rollcallSchema>;

/** A circle's open or latest roll call (null when there is none in the last 24 hours). */
export const rollcallViewSchema = z.object({ rollcall: rollcallSchema.nullable() }).strict();
export type RollcallView = z.infer<typeof rollcallViewSchema>;

/** Refusals a phone can act on; everything else is an error. */
export const ROLLCALL_REFUSALS = [
  'NOT_OWNER',
  'NOT_EVENT',
  'ALREADY_OPEN',
  'RATE_LIMITED',
  'CLOSED',
  'NOT_ELIGIBLE',
  'INVALID',
  'EPOCH',
] as const;
export type RollcallRefusal = (typeof ROLLCALL_REFUSALS)[number];
export const rollcallReplySchema = z.union([
  z.object({ ok: z.literal(true), rollcall: rollcallSchema }).strict(),
  z.object({ refused: z.enum(ROLLCALL_REFUSALS) }).strict(),
]);
export type RollcallReply = z.infer<typeof rollcallReplySchema>;

/** "Etkinlik yoklamaları" (docs/ADR/0040 §6): whether this person takes part in roll calls. */
export const rollcallSettingSchema = z.object({ on: z.boolean() }).strict();
export type RollcallSetting = z.infer<typeof rollcallSettingSchema>;
