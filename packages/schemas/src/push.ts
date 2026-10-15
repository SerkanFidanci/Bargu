import { z } from 'zod';

import { messageEnvelopeSchema } from './envelope.js';
import { placeEmojiSchema, placeNameSchema, timestamp } from './payload.js';
import { MAX_CIRCLE_MEMBERS } from './circles.js';

/** News the server itself announces (it knows them anyway); the app words them in its language. */
export const PUSH_NOTICES = [
  'friendRequest',
  'friendAccepted',
  'friendAdded',
  'circleInvite',
  'memberJoined',
  // Guardians (docs/ADR/0023 §4); the "circle" they name is the link.
  'guardianRequest',
  'guardianLinked',
  'guardianEndRequested',
  'guardianEnded',
] as const;
export type PushNotice = (typeof PUSH_NOTICES)[number];

/**
 * What a notification says, sealed for one device (docs/PROTOCOL.md §7, docs/ADR/0016): Google
 * and Apple carry only ciphertext. `place` and `bump` are signed by the member's phone that sent
 * them; `notice` comes from the server and only ever names a kind and a circle.
 */
export const pushBodySchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('place'),
      circleId: z.uuid(),
      placeId: z.uuid(),
      event: z.enum(['enter', 'exit']),
      /** The place as the sender's phone knows it (the iOS extension has no place list). */
      name: placeNameSchema,
      emoji: placeEmojiSchema,
      ts: timestamp,
    })
    .strict(),
  z.object({ kind: z.literal('bump'), circleId: z.uuid(), ts: timestamp }).strict(),
  /** "Ali will be about 10 minutes late" to the event's meeting (docs/ADR/0018). */
  z
    .object({
      kind: z.literal('late'),
      circleId: z.uuid(),
      minutes: z.number().int().min(1).max(600),
      ts: timestamp,
    })
    .strict(),
  z
    .object({
      kind: z.literal('notice'),
      notice: z.enum(PUSH_NOTICES),
      circleId: z.uuid(),
      ts: timestamp,
    })
    .strict(),
]);
export type PushBody = z.infer<typeof pushBodySchema>;

/**
 * A sealed push in base64url. Phones' bodies (a place with a 40-character name, at most) seal to
 * about 900 characters; the cap keeps a poke to a full circle within the request size limit.
 */
export const MAX_SEALED_PUSH_CHARS = 1_100;
export const sealedPushSchema = z
  .string()
  .min(1)
  .max(MAX_SEALED_PUSH_CHARS)
  .regex(/^[A-Za-z0-9_-]+$/);

/**
 * Notifications a phone prepared for the other members' devices, one sealed box each. The server
 * hands each to that device's push service only if it is the current device of a member of the
 * circle who is not online (the app shows it itself otherwise).
 */
export const devicePushesSchema = z
  .array(z.object({ userId: z.uuid(), deviceId: z.uuid(), sealed: sealedPushSchema }).strict())
  .max(MAX_CIRCLE_MEMBERS);
export type DevicePushes = z.infer<typeof devicePushesSchema>;

/**
 * A member arrived at or left one of the circle's places (encrypted `place_enter` / `place_exit`),
 * or will be late to an event's meeting (`late`, docs/ADR/0018).
 */
export const placeEventRequestSchema = z
  .object({ envelope: messageEnvelopeSchema, pushes: devicePushesSchema })
  .strict();
export type PlaceEventRequest = z.infer<typeof placeEventRequestSchema>;
export const placeEventSchema = z.object({ envelope: messageEnvelopeSchema }).strict();
