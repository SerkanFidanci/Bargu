import { z } from 'zod';

import { historyEnvelopeSchema } from './envelope.js';
import { timestamp } from './payload.js';

/**
 * Location history stays on the server this long, then it is deleted (docs/ADR/0019): the last two
 * weeks, a Bargu+ feature (a circle without a payer pauses altogether, BARGU_PLAN Faz 9B).
 */
export const HISTORY_DAYS = 14;
export const HISTORY_KEEP_MS = HISTORY_DAYS * 24 * 60 * 60_000;
/** Each member's trail goes up per circle in pieces of a quarter hour. */
export const HISTORY_SLOT_MS = 15 * 60_000;
/** Most points one piece holds: a quarter hour of driving, simplified, fits the largest size. */
export const MAX_TRAIL_POINTS = 250;

/** Start of the quarter hour a moment falls in. */
export function historySlot(at: number): number {
  return Math.floor(at / HISTORY_SLOT_MS) * HISTORY_SLOT_MS;
}

/**
 * One point of a trail: seconds into its quarter hour, latitude and longitude in hundred-
 * thousandths of a degree (about a metre), accuracy in metres.
 */
export const trailPointSchema = z.tuple([
  z
    .number()
    .int()
    .min(0)
    .max(HISTORY_SLOT_MS / 1000),
  z.number().int().min(-9_000_000).max(9_000_000),
  z.number().int().min(-18_000_000).max(18_000_000),
  z.number().int().min(0).max(10_000),
]);
export type TrailPoint = z.infer<typeof trailPointSchema>;

/**
 * A quarter hour of a member's trail, encrypted for one circle (docs/ADR/0019): only members who
 * were in the circle then hold the key that opens it.
 */
export const trailPayloadSchema = z
  .object({
    kind: z.literal('trail'),
    /** The quarter hour it covers (a multiple of HISTORY_SLOT_MS). */
    from: timestamp.refine((at) => at % HISTORY_SLOT_MS === 0, 'not the start of a quarter hour'),
    points: z.array(trailPointSchema).min(1).max(MAX_TRAIL_POINTS),
    ts: timestamp,
  })
  .strict();
export type TrailPayload = z.infer<typeof trailPayloadSchema>;

/** A piece as the server keeps it: whose, which quarter hour, the sealed trail. */
export const historyRecordSchema = z
  .object({ userId: z.uuid(), from: timestamp, envelope: historyEnvelopeSchema })
  .strict();
export type HistoryRecord = z.infer<typeof historyRecordSchema>;

export const historySchema = z.object({ chunks: z.array(historyRecordSchema) }).strict();

export const historyPutSchema = z.object({ envelope: historyEnvelopeSchema }).strict();

/** Which part of a member's history to fetch (Unix ms, at most HISTORY_DAYS back). */
export const historyQuerySchema = z
  .object({ from: z.coerce.number().int().nonnegative(), to: z.coerce.number().int().positive() })
  .strict()
  .refine((query) => query.from < query.to, 'from must be before to');

/** Live message to members on the circle's screen: a new piece of someone's trail is up. */
export const historyEventSchema = z.object({ circleId: z.uuid(), userId: z.uuid() }).strict();
