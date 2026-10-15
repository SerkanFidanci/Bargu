import { z } from 'zod';

import { ageBandSchema } from './auth.js';
import { CIRCLE_KINDS, inviteTokenSchema, publicProfileSchema } from './circles.js';

/**
 * Guardians (docs/ADR/0023 §4): a parent (18+) and a child (15-17), linked in person by mutual
 * approval. No hidden monitoring: the child sees what the parent sees, and the link gives no
 * location.
 */
export const MAX_GUARDIANS = 2;
/** How long the child's code (QR or link) can be taken. */
export const GUARDIAN_CODE_TTL_MS = 10 * 60_000;
/** A child's request to end a link takes effect when the parent agrees, or after this. */
export const GUARDIAN_END_AFTER_MS = 7 * 24 * 3600_000;

/** The child's one-time code, shown as a QR code and as a link (`bargu://g/<token>`). */
export const guardianCodeSchema = z
  .object({ token: inviteTokenSchema, link: z.string(), expiresAt: z.number().int() })
  .strict();
export type GuardianCode = z.infer<typeof guardianCodeSchema>;

export const guardianTokenBodySchema = z.object({ token: inviteTokenSchema }).strict();

/** Whose code a parent is about to take. */
export const guardianPreviewSchema = z.object({ child: publicProfileSchema }).strict();
export type GuardianPreview = z.infer<typeof guardianPreviewSchema>;

/** A link as one side sees it: their role in it, and the other side. */
export const guardianLinkSchema = z
  .object({
    id: z.uuid(),
    role: z.enum(['child', 'guardian']),
    /** confirming: the parent said yes, the child has not yet. */
    status: z.enum(['confirming', 'active']),
    other: publicProfileSchema,
    createdAt: z.number().int(),
    activeAt: z.number().int().nullable(),
    /** The child asked to end it: it ends at `endsAt` unless the parent agrees sooner. */
    endRequestedAt: z.number().int().nullable(),
    endsAt: z.number().int().nullable(),
  })
  .strict();
export type GuardianLink = z.infer<typeof guardianLinkSchema>;

export const guardianLinksSchema = z.object({ links: z.array(guardianLinkSchema) }).strict();

/** Ended at once, or (the child ending an active link) asked for. */
export const guardianEndSchema = z
  .object({ ended: z.boolean(), endsAt: z.number().int().nullable() })
  .strict();
export type GuardianEnd = z.infer<typeof guardianEndSchema>;

/**
 * What the parent sees, and the child sees the same: the child's age band and everyone who could
 * see the child's location (the child's circles and the people in them). Never the location.
 */
export const guardianViewSchema = z
  .object({
    link: guardianLinkSchema,
    child: publicProfileSchema,
    ageBand: ageBandSchema,
    circles: z.array(
      z
        .object({
          kind: z.enum(CIRCLE_KINDS),
          /** Null for a friendship (a pair): its one other member is the friend. */
          name: z.string().nullable(),
          members: z.array(
            z
              .object({ username: z.string().nullable(), displayName: z.string().nullable() })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type GuardianView = z.infer<typeof guardianViewSchema>;
