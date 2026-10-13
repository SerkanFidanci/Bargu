import { z } from 'zod';

/** Unix epoch milliseconds. */
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

/**
 * Location update. Precision reduction (grid snap) happens on the sender before encryption, so
 * the receiver may get a cell centre with a correspondingly large `acc`.
 */
export const locPayloadSchema = z
  .object({
    kind: z.literal('loc'),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Accuracy radius in metres. */
    acc: z.number().nonnegative().max(1_000_000),
    /** Speed in m/s; omitted below full precision. */
    spd: z.number().nonnegative().max(1_000).optional(),
    /** Heading in degrees clockwise from north, [0, 360); omitted below full precision. */
    hdg: z.number().min(0).lt(360).optional(),
    /** Battery percentage. */
    bat: z.number().int().min(0).max(100),
    /** Charging. */
    chg: z.boolean(),
    ts: timestamp,
  })
  .strict();

export const bumpPayloadSchema = z.object({ kind: z.literal('bump'), ts: timestamp }).strict();

export const placeEnterPayloadSchema = z
  .object({ kind: z.literal('place_enter'), placeId: z.uuid(), ts: timestamp })
  .strict();

export const placeExitPayloadSchema = z
  .object({ kind: z.literal('place_exit'), placeId: z.uuid(), ts: timestamp })
  .strict();

export const shareStopPayloadSchema = z
  .object({ kind: z.literal('share_stop'), ts: timestamp })
  .strict();

export const statusPayloadSchema = z
  .object({
    kind: z.literal('status'),
    emoji: z.string().min(1).max(16).optional(),
    text: z.string().min(1).max(80).optional(),
    expiresAt: timestamp,
    ts: timestamp,
  })
  .strict();

/** Everything a sender can put inside an encrypted envelope (BARGU_PLAN §3.1). */
export const payloadSchema = z.discriminatedUnion('kind', [
  locPayloadSchema,
  bumpPayloadSchema,
  placeEnterPayloadSchema,
  placeExitPayloadSchema,
  shareStopPayloadSchema,
  statusPayloadSchema,
]);

export type Payload = z.infer<typeof payloadSchema>;
export type LocPayload = z.infer<typeof locPayloadSchema>;
