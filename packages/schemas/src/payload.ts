import { z } from 'zod';

import { cosmeticIdSchema, cosmeticPassSchema } from './cosmetics.js';

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
    /**
     * On the way to the circle's meeting (docs/ADR/0018): when the sender's phone estimates to be
     * there, for the meeting at `meetAt`. Full precision only (dropped by applyPrecision).
     */
    eta: z.object({ meetAt: timestamp, at: timestamp }).strict().optional(),
    ts: timestamp,
  })
  .strict();

/**
 * A random id of 16 bytes in base64url (22 characters, canonical: the last character carries no
 * stray bits). A "Güvendeyim" message is named by one, so a repeat of it can be told from a new
 * message (docs/ADR/0029).
 */
export const safeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{21}[AQgw]$/);

/**
 * Why a phone's last location is old (docs/ADR/0028 "Neden eski?"): `saver` the phone is in battery
 * saver and reports rarely, `permission` the location permission is off or was taken back, `nofix`
 * no position can be had (location services off, nothing coming in). `none`: it no longer applies.
 * "Offline" is never here: the receiver infers it from silence, so a phone that cannot send says
 * nothing about itself.
 */
export const STATE_WHY = ['saver', 'permission', 'nofix', 'none'] as const;
export type StateWhy = (typeof STATE_WHY)[number];

/**
 * A reason, not a position (docs/ADR/0028 "Neden eski?"): a separate kind and not a field of `loc`,
 * which is read strictly (an older app would refuse every location that carried it). Carries no
 * coordinates, accuracy, speed or battery; padded like every message. `since`: when this reason
 * began (or, for `none`, when it ended). Read leniently like `look`, so a field a newer phone adds
 * does not make older ones refuse it; an older app that does not know the kind drops it whole.
 */
export const statePayloadSchema = z.object({
  kind: z.literal('state'),
  why: z.enum(STATE_WHY),
  since: timestamp,
  ts: timestamp,
});
export type StatePayload = z.infer<typeof statePayloadSchema>;

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
 * server keeps under its `photo.id`. Null: no photo (the emoji avatar shows). Not strict, unlike the
 * other payloads (ADR 0024 §10): a field a newer phone adds is dropped, so older apps keep reading
 * the profile and its photo instead of refusing the whole message.
 */
export const profilePayloadSchema = z.object({
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
});

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

/**
 * An event's meeting (docs/ADR/0018): when, and at which of the circle's places. One per circle
 * (its id is the circle's), editable by every member, stored encrypted like places.
 */
export const planPayloadSchema = z.object({
  kind: z.literal('plan'),
  id: z.uuid(),
  meetAt: timestamp.optional(),
  placeId: z.uuid().optional(),
  /**
   * Who started a meeting outside an event (docs/ADR/0026): they and the circle's admins change
   * or end it. Never in an event's plan, which older apps read strictly.
   */
  by: z.uuid().optional(),
  /**
   * The place was added for this meeting outside an event (docs/ADR/0026 Ek 1): true, it goes
   * with the meeting; false, its starter keeps it. Missing: a place the circle had already, which
   * always stays. Older apps read plans loosely and drop it (they keep the place).
   */
  placeGoes: z.boolean().optional(),
  ts: timestamp,
});
export type PlanPayload = z.infer<typeof planPayloadSchema>;

/** Options of a poll: two to four times, or two to four of the circle's places. */
export const MAX_POLL_OPTIONS = 4;
const timeOptionSchema = z.object({ at: timestamp }).strict();
const placeOptionSchema = z.object({ placeId: z.uuid(), name: placeNameSchema }).strict();

/**
 * A poll on an event's meeting time or place (docs/ADR/0018). Whoever started it closes it; the
 * winning option then becomes the meeting's time or place.
 */
export const pollPayloadSchema = z
  .object({
    kind: z.literal('poll'),
    id: z.uuid(),
    /** Who started it (they, and the event's owner, close it). */
    by: z.uuid(),
    about: z.enum(['time', 'place']),
    options: z
      .array(z.union([timeOptionSchema, placeOptionSchema]))
      .min(2)
      .max(MAX_POLL_OPTIONS),
    /** Set when closed: the option chosen. */
    closed: z
      .object({
        choice: z
          .number()
          .int()
          .min(0)
          .max(MAX_POLL_OPTIONS - 1),
      })
      .strict()
      .optional(),
    ts: timestamp,
  })
  .strict()
  .refine(
    (poll) =>
      poll.options.every((option) => 'at' in option === (poll.about === 'time')) &&
      (poll.closed === undefined || poll.closed.choice < poll.options.length),
    'options must match the poll and the choice must exist',
  );
export type PollPayload = z.infer<typeof pollPayloadSchema>;

/** A member's vote in a poll: the options they are fine with (stored as their own document). */
export const votePayloadSchema = z
  .object({
    kind: z.literal('vote'),
    id: z.uuid(),
    pollId: z.uuid(),
    choices: z
      .array(
        z
          .number()
          .int()
          .min(0)
          .max(MAX_POLL_OPTIONS - 1),
      )
      .max(MAX_POLL_OPTIONS),
    ts: timestamp,
  })
  .strict();
export type VotePayload = z.infer<typeof votePayloadSchema>;

/**
 * "Güvendeyim" (docs/ADR/0029): the sender says they are safe, with where they are and how much
 * battery they have. Sent once to each circle the sender chose, with the location at THAT circle's
 * precision (applyPrecision: a coarse circle gets the coarse cell). It is a message of its own,
 * not a live location: nothing follows it, and a ghost stays a ghost. `id` is random and names the
 * message; the server remembers a hash of it for a day to drop a repeat, the receivers remember it
 * to show it once.
 */
export const safePayloadSchema = z
  .object({
    kind: z.literal('safe'),
    id: safeIdSchema,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    /** Accuracy radius in metres. */
    acc: z.number().nonnegative().max(1_000_000),
    /** Battery percentage. */
    bat: z.number().int().min(0).max(100),
    ts: timestamp,
  })
  .strict();
export type SafePayload = z.infer<typeof safePayloadSchema>;

/** "I will be about this late" to the meeting at `meetAt` (sent once per estimate, not stored). */
export const latePayloadSchema = z
  .object({
    kind: z.literal('late'),
    meetAt: timestamp,
    minutes: z.number().int().min(1).max(600),
    ts: timestamp,
  })
  .strict();

/**
 * "Geldim" (docs/ADR/0026 §5): the sender says they are at the meeting themselves, so a coarse
 * location never has to tell it. Names the meeting by its time, like `late`.
 */
export const arrivedPayloadSchema = z.object({
  kind: z.literal('arrived'),
  meetAt: timestamp,
  ts: timestamp,
});

/** Everything a sender can put inside an encrypted message envelope (BARGU_PLAN §3.1). */
/**
 * The sender's look (docs/ADR/0025 §3): the ring pattern and the pin frame they chose, and the
 * server's pass that says they own them; null for the plain look. Sent where the profile goes;
 * each viewer checks the pass and shows the plain look when it does not hold. Read leniently, and
 * a look this app does not know is shown plain.
 */
export const lookPayloadSchema = z.object({
  kind: z.literal('look'),
  ring: cosmeticIdSchema.nullable(),
  frame: cosmeticIdSchema.nullable(),
  pass: cosmeticPassSchema.nullable(),
  ts: timestamp,
});

export const payloadSchema = z.discriminatedUnion('kind', [
  locPayloadSchema,
  bumpPayloadSchema,
  placeEnterPayloadSchema,
  placeExitPayloadSchema,
  shareStopPayloadSchema,
  statusPayloadSchema,
  profilePayloadSchema,
  placePayloadSchema,
  latePayloadSchema,
  lookPayloadSchema,
  arrivedPayloadSchema,
  safePayloadSchema,
  statePayloadSchema,
]);

/**
 * What a circle keeps as documents, in the larger document envelope (docs/ADR/0018): its meeting,
 * its polls and the votes in them. Never relayed as a message, and no message is a document.
 */
export const docPayloadSchema = z.discriminatedUnion('kind', [
  planPayloadSchema,
  pollPayloadSchema,
  votePayloadSchema,
]);
export type DocPayload = z.infer<typeof docPayloadSchema>;

export type Payload = z.infer<typeof payloadSchema>;
export type LocPayload = z.infer<typeof locPayloadSchema>;
