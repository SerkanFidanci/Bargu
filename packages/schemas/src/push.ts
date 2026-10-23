import { z } from 'zod';

import { messageEnvelopeSchema } from './envelope.js';
import {
  placeEmojiSchema,
  placeNameSchema,
  POKE_SAYINGS,
  POKE_STYLES,
  safeIdSchema,
  timestamp,
} from './payload.js';
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
  // Guardian tools (docs/ADR/0023 §5).
  'guardianApproval',
  'guardianApproved',
  'guardianDeclined',
  'guardianSettings',
  // Someone new in a circle of the child (PM decision on QA 5c F-2); names the link.
  'guardianNewMember',
  // The child asks for Bargu+ (docs/ADR/0024 §5); names the link.
  'guardianPurchase',
  // The child asks for a cosmetic pack (docs/ADR/0025 §6); names the link.
  'guardianCosmetic',
  // Someone looks at this circle on the map right now (docs/ADR/0028 step 3): it wakes a phone
  // whose app is closed so it can go live for a while. Silent: never shown, names no watcher.
  'watch',
] as const;
export type PushNotice = (typeof PUSH_NOTICES)[number];

/**
 * What a notification says, sealed for one device (docs/PROTOCOL.md §7, docs/ADR/0016): Google
 * and Apple carry only ciphertext. `place`, `bump`, `late`, `meeting` and `safe` are signed by the
 * member's phone that sent them; `notice` comes from the server and only ever names a kind and a circle.
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
  // A poke with a feeling or a question (docs/ADR/0031), sealed only for the one it is for: the
  // receiving phone writes "Ayşe seni öptü 💋" or "Ayşe: Nerdesin?" from it.
  z
    .object({
      kind: z.literal('poke'),
      circleId: z.uuid(),
      style: z.enum(POKE_STYLES),
      say: z.enum(POKE_SAYINGS).optional(),
      ts: timestamp,
    })
    .strict()
    // As in the message: a reply says one of the ready replies, and only a reply does (QA-36).
    .refine((poke) => (poke.style === 'reply') === (poke.say !== undefined)),
  // "Güvendeyim" (docs/ADR/0029): the receiving phone writes "Ali: İyiyim ✓ · %45" from it, and
  // keeps where they are (at that circle's precision) for a day, so a phone whose app is closed
  // can show the place when the notification is tapped. The location is in the sealed box only:
  // Google and Apple see its size and time. Whole or not at all (`lat`, `lng` and `acc` go
  // together; a push from before the location has none). `id` is the message's own, so a phone
  // that gets both the message and this shows it once. `ts` is when the sender tapped.
  z
    .object({
      kind: z.literal('safe'),
      circleId: z.uuid(),
      id: safeIdSchema,
      bat: z.number().int().min(0).max(100),
      lat: z.number().min(-90).max(90).optional(),
      lng: z.number().min(-180).max(180).optional(),
      /** Accuracy radius in metres. */
      acc: z.number().nonnegative().max(1_000_000).optional(),
      ts: timestamp,
    })
    .strict()
    .refine(
      (body) =>
        [body.lat, body.lng, body.acc].every((part) => part === undefined) ||
        [body.lat, body.lng, body.acc].every((part) => part !== undefined),
      'a location is lat, lng and acc together',
    ),
  /** "Ali will be about 10 minutes late" to the event's meeting (docs/ADR/0018). */
  z
    .object({
      kind: z.literal('late'),
      circleId: z.uuid(),
      minutes: z.number().int().min(1).max(600),
      ts: timestamp,
    })
    .strict(),
  // A member started a meeting in the circle (docs/ADR/0026 §6): where, as their phone names it,
  // and when. Signed by that member's phone.
  z
    .object({
      kind: z.literal('meeting'),
      circleId: z.uuid(),
      name: placeNameSchema,
      emoji: placeEmojiSchema,
      meetAt: timestamp,
      ts: timestamp,
    })
    .strict(),
  // An answer to a meeting outside an event, for its starter (docs/ADR/0026 Ek 2): 0 Geliyorum,
  // 1 Belki, 2 Gelemiyorum, and how many come and maybe come with it. Signed by the answering
  // member's phone.
  z
    .object({
      kind: z.literal('meetingAnswer'),
      circleId: z.uuid(),
      answer: z.number().int().min(0).max(2),
      going: z.number().int().min(0).max(10_000),
      maybe: z.number().int().min(0).max(10_000),
      ts: timestamp,
    })
    .strict(),
  // The meeting moved (its time or place), for those who said Geliyorum or Belki (Ek 2): where and
  // when now. Signed by the phone of whoever moved it.
  z
    .object({
      kind: z.literal('meetingMoved'),
      circleId: z.uuid(),
      name: placeNameSchema,
      emoji: placeEmojiSchema,
      meetAt: timestamp,
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
