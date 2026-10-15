import { z } from 'zod';

import { docEnvelopeSchema } from './envelope.js';

/** Documents one event can hold: its meeting, a few polls and every member's vote in each. */
export const MAX_DOCS_PER_CIRCLE = 300;

/**
 * A circle's document as the server keeps it (docs/ADR/0018): the signed, encrypted message of the
 * member who last saved it. `shared` documents (a plan, a poll) any member may change; the others
 * (a vote) only their author.
 */
export const docRecordSchema = z
  .object({
    circleId: z.uuid(),
    id: z.uuid(),
    version: z.number().int().positive(),
    shared: z.boolean(),
    envelope: docEnvelopeSchema,
  })
  .strict();
export type DocRecord = z.infer<typeof docRecordSchema>;

export const docsSchema = z.object({ docs: z.array(docRecordSchema) }).strict();

/** Saves a document: `version` is the one being replaced (null: a new one). */
export const docPutSchema = z
  .object({
    envelope: docEnvelopeSchema,
    version: z.number().int().positive().nullable(),
    shared: z.boolean(),
  })
  .strict();
export type DocPut = z.infer<typeof docPutSchema>;
export const docPutReplySchema = z.object({ version: z.number().int().positive() }).strict();
