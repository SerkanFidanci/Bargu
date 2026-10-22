import { z } from 'zod';

import { ageBandSchema } from './auth.js';
import { PLUS_PRODUCTS } from './billing.js';
import { CIRCLE_KINDS, inviteTokenSchema, publicProfileSchema } from './circles.js';
import { cosmeticIdSchema } from './cosmetics.js';

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

/** The child's one-time code, shown as a QR code and as a link (`https://<host>/g#<token>`, docs/ADR/0009 Ek 2). */
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

/** The parent's settings for the child (docs/ADR/0023 §5). */
export const DAILY_LIMIT_MINUTES = { min: 30, max: 360 } as const;
export const guardianSettingsSchema = z
  .object({
    /** A friendship, a group or an event waits for a parent's yes. */
    approveNewPeople: z.boolean(),
    /** The app closes for the day after this many minutes open; null: no limit. */
    dailyLimitMinutes: z
      .number()
      .int()
      .min(DAILY_LIMIT_MINUTES.min)
      .max(DAILY_LIMIT_MINUTES.max)
      .nullable(),
  })
  .strict();
export type GuardianSettings = z.infer<typeof guardianSettingsSchema>;

/**
 * Something new the child asked for, waiting for a parent's yes. Read leniently (a field a newer
 * server adds is dropped), and a list of them skips a kind this app does not know yet.
 */
export const guardianRequestSchema = z.object({
  id: z.uuid(),
  /**
   * The child asks: friend (to befriend `name`), group / event (to join `name`, made by `by`),
   * purchase (Bargu+, `product`; docs/ADR/0024 §5), cosmetic (a pack, `pack`; docs/ADR/0025 §6;
   * apart from a purchase: neither replaces the other). Someone comes to the child (QA 5c F-2):
   * befriends (`by` used the child's friend code), joins (`by` used the child's code for
   * `name`), invites (the child invites `by` into `name`). gone: the code stopped working
   * meanwhile (a yes would do nothing).
   */
  kind: z.enum([
    'friend',
    'group',
    'event',
    'befriends',
    'joins',
    'invites',
    'purchase',
    'cosmetic',
    'gone',
  ]),
  /**
   * The group's or event's name, or the friend's display name. Never a username: a parent cannot
   * look anyone up (the owner's decision on QA 5b G-1).
   */
  name: z.string().nullable(),
  memberCount: z.number().int().nullable(),
  /** Who made the code (display name), when it was a code. */
  by: z.string().nullable(),
  /** The plan asked for, for a purchase only. */
  product: z.enum(PLUS_PRODUCTS).optional(),
  /**
   * The pack asked for (`rings`, not `cosmetic:rings`), for a cosmetic request only. Any id: an app
   * that does not know the pack yet words it in general.
   */
  pack: cosmeticIdSchema.optional(),
  createdAt: z.number().int(),
});
export type GuardianRequest = z.infer<typeof guardianRequestSchema>;

/** The requests this app can read: one of a newer kind is left out, not the whole view. */
const readableRequests = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = guardianRequestSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  }),
);

/** The child's own rules as the phone applies them (docs/ADR/0023 §5). */
export const guardianRulesSchema = z
  .object({ linked: z.boolean(), settings: guardianSettingsSchema.nullable() })
  .strict();
export type GuardianRules = z.infer<typeof guardianRulesSchema>;

/** The minutes the app was open on a day of the child's phone (its own calendar). */
export const usageReportSchema = z
  .object({
    day: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      // A day that exists (QA 5c F-3): 2026-13-45 is refused, not left to the database.
      .refine((day) => {
        const date = new Date(`${day}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(day);
      }),
    minutes: z.number().int().min(0).max(1440),
  })
  .strict();
export type UsageReport = z.infer<typeof usageReportSchema>;

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
          /**
           * Display names only: a parent cannot look these people up (QA 5b G-1). `isNew`: came in
           * during the last 7 days, since the link (PM decision on QA 5c F-2).
           */
          members: z.array(
            z.object({ displayName: z.string().nullable(), isNew: z.boolean() }).strict(),
          ),
        })
        .strict(),
    ),
    settings: guardianSettingsSchema.extend({
      updatedAt: z.number().int(),
      /** Which parent changed them last (username); null when nobody has yet. */
      updatedBy: z.string().nullable(),
    }),
    /** Minutes the app was open, the last 7 days, oldest first. */
    usage: z.array(usageReportSchema),
    requests: readableRequests,
  })
  .strict();
export type GuardianView = z.infer<typeof guardianViewSchema>;
