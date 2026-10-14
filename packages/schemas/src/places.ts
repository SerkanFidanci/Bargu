import { z } from 'zod';

import { messageEnvelopeSchema } from './envelope.js';

/** Places one circle can have (a family's homes, schools, work places). */
export const MAX_PLACES_PER_CIRCLE = 30;

/**
 * A place as the server keeps it (docs/ADR/0015): an encrypted, signed `place` message of the
 * member who last saved it, and a version that grows with every save (compare-and-set).
 */
export const placeRecordSchema = z
  .object({
    circleId: z.uuid(),
    id: z.uuid(),
    version: z.number().int().positive(),
    envelope: messageEnvelopeSchema,
  })
  .strict();
export type PlaceRecord = z.infer<typeof placeRecordSchema>;

export const placesSchema = z.object({ places: z.array(placeRecordSchema) }).strict();

/** Saves a place: `version` is the one being replaced (null: a new place). */
export const placePutSchema = z
  .object({ envelope: messageEnvelopeSchema, version: z.number().int().positive().nullable() })
  .strict();
export type PlacePut = z.infer<typeof placePutSchema>;
export const placePutReplySchema = z.object({ version: z.number().int().positive() }).strict();
