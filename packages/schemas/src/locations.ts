import { z } from 'zod';

import { messageEnvelopeSchema } from './envelope.js';

/**
 * Envelopes per publish: one per circle the device shares with. Keeps a WebSocket frame well
 * under the 16 KB limit; a phone in more circles sends several publishes.
 */
export const MAX_ENVELOPES_PER_PUBLISH = 10;
/** Circles named in one withdraw request. */
export const MAX_CIRCLES_PER_REQUEST = 50;

/** This device's latest encrypted message for some of its circles (BARGU_PLAN §3.4, relay). */
export const locationPublishSchema = z
  .object({ envelopes: z.array(messageEnvelopeSchema).min(1).max(MAX_ENVELOPES_PER_PUBLISH) })
  .strict();
export type LocationPublish = z.infer<typeof locationPublishSchema>;

export const RELAY_REFUSALS = ['INVALID', 'NOT_MEMBER', 'EPOCH', 'RATE_LIMITED'] as const;

/** What the relay did with each envelope (refused ones are not stored or forwarded). */
export const publishReplySchema = z
  .object({
    accepted: z.number().int().nonnegative(),
    refused: z.array(z.object({ circleId: z.uuid(), code: z.enum(RELAY_REFUSALS) }).strict()),
  })
  .strict();
export type PublishReply = z.infer<typeof publishReplySchema>;

/** Stop showing this device's last location in these circles (hide, sharing off). */
export const locationWithdrawSchema = z
  .object({ circleIds: z.array(z.uuid()).min(1).max(MAX_CIRCLES_PER_REQUEST) })
  .strict();

/** Latest envelope of every other member, for all circles the user is active in. */
export const locationSnapshotSchema = z
  .object({ envelopes: z.array(messageEnvelopeSchema) })
  .strict();

/** "I am looking at this circle on the map": its members switch to live updates for a while. */
export const watchRequestSchema = z.object({ circleId: z.uuid() }).strict();

/** Live server → app messages (not part of the resumable event stream: last write wins). */
export const locEventSchema = z.object({ envelope: messageEnvelopeSchema }).strict();
export const locGoneEventSchema = z.object({ circleId: z.uuid(), userId: z.uuid() }).strict();
export const watchEventSchema = z.object({ circleId: z.uuid() }).strict();
