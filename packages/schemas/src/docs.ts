import { z } from 'zod';

import { docEnvelopeSchema } from './envelope.js';
import { timestamp } from './payload.js';
import { devicePushesSchema } from './push.js';

/** Documents one event can hold: its meeting, a few polls and every member's vote in each. */
export const MAX_DOCS_PER_CIRCLE = 300;
/** Polls one member may start in one event (QA Faz 8 O4); each member votes once per poll. */
export const MAX_POLLS_PER_MEMBER = 20;

/**
 * What a document is, as the server knows it (docs/ADR/0020): the meeting (filed under the
 * event's id), a poll, or a vote (filed under its voter's id for that poll). Not what it says.
 */
export const DOC_KINDS = ['plan', 'poll', 'vote'] as const;
export const docKindSchema = z.enum(DOC_KINDS);
export type DocKind = z.infer<typeof docKindSchema>;

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

/**
 * Saves a document: `version` is the one being replaced (null: a new one). A vote names its poll;
 * nothing else does.
 */
export const docPutSchema = z
  .object({
    envelope: docEnvelopeSchema,
    version: z.number().int().positive().nullable(),
    kind: docKindSchema,
    pollId: z.uuid().nullable(),
    /**
     * A meeting outside an event (docs/ADR/0026 §2): when the server deletes it (its time + 3
     * hours). An event's documents say none.
     */
    endsAt: timestamp.optional(),
    /** Starting such a meeting: one sealed notice per other member's device (ADR 0026 §6). */
    pushes: devicePushesSchema.optional(),
  })
  .strict()
  .refine((put) => (put.kind === 'vote') === (put.pollId !== null), {
    message: 'a vote names its poll, nothing else does',
    path: ['pollId'],
  });
export type DocPut = z.infer<typeof docPutSchema>;
export const docPutReplySchema = z.object({ version: z.number().int().positive() }).strict();
