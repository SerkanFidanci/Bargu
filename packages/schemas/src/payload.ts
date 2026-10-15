import { z } from 'zod';

/** Unix epoch milliseconds. */
export const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

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
    /**
     * Since when the sender has stayed within ~100 m of here (their phone keeps track), so every
     * viewer can show "settled" alike; omitted below full precision.
     */
    since: timestamp.optional(),
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

/**
 * User-visible text: no control characters (JSON would inflate them past the fixed padded size),
 * no lone surrogates and no bidi overrides (they can visually reorder what others see).
 */
export const UNSAFE_TEXT = /[\p{Cc}\p{Cs}\u202A-\u202E\u2066-\u2069]/u;
export const displayText = (maxLength: number) =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((text) => !UNSAFE_TEXT.test(text), 'contains control or bidi characters');

export const statusPayloadSchema = z
  .object({
    kind: z.literal('status'),
    emoji: displayText(16).optional(),
    text: displayText(80).optional(),
    expiresAt: timestamp,
    ts: timestamp,
  })
  .strict();

const photoKeySchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/**
 * The sender's profile photo key (docs/ADR/0014): with it members open the encrypted photo the
 * server keeps under its `photo.id`. Null: no photo (the emoji avatar shows).
 */
export const profilePayloadSchema = z
  .object({
    kind: z.literal('profile'),
    photo: z.object({ id: z.uuid(), key: photoKeySchema }).strict().nullable(),
    /**
     * Photo keys of members whose phone changed (reinstall, new phone), handed back so their new
     * phone can open its own photo again; it checks the key against the photo the server holds.
     * At most two per message (the padded size); more go with the next one.
     */
    returns: z
      .array(z.object({ userId: z.uuid(), id: z.uuid(), key: photoKeySchema }).strict())
      .min(1)
      .max(2)
      .optional(),
    ts: timestamp,
  })
  .strict();

/** A place's circle on the map: from a house to a campus (the app offers 100 / 250 / 500 m). */
export const PLACE_RADIUS_M = { min: 50, max: 1_000 } as const;
export const PLACE_NAME_MAX = 40;
export const placeNameSchema = displayText(PLACE_NAME_MAX);
export const placeEmojiSchema = displayText(16);

/**
 * A place of a circle (BARGU_PLAN §4.3 "Yerler"), as its members' phones store it on the server:
 * encrypted like any message, so the server keeps only ciphertext. `ts` only grows with every
 * edit (the editor takes the later of now and the previous `ts` + 1), so a phone never goes back
 * to an older version the server might serve again.
 */
export const placePayloadSchema = z
  .object({
    kind: z.literal('place'),
    id: z.uuid(),
    name: placeNameSchema,
    emoji: placeEmojiSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    radius: z.number().int().min(PLACE_RADIUS_M.min).max(PLACE_RADIUS_M.max),
    ts: timestamp,
  })
  .strict();
export type PlacePayload = z.infer<typeof placePayloadSchema>;

/** Everything a sender can put inside an encrypted envelope (BARGU_PLAN §3.1). */
export const payloadSchema = z.discriminatedUnion('kind', [
  locPayloadSchema,
  bumpPayloadSchema,
  placeEnterPayloadSchema,
  placeExitPayloadSchema,
  shareStopPayloadSchema,
  statusPayloadSchema,
  profilePayloadSchema,
  placePayloadSchema,
]);

export type Payload = z.infer<typeof payloadSchema>;
export type LocPayload = z.infer<typeof locPayloadSchema>;
