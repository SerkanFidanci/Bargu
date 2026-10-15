import { z } from 'zod';

import { AGE_METHODS, ageBandSchema, PLATFORMS, SECURITY_EVENT_TYPES } from './auth.js';
import { CIRCLE_KINDS, MEMBER_ROLES, MEMBER_STATUSES } from './circles.js';
import { avatarSchema } from './profile.js';

/**
 * KVKK records (docs/ADR/0022). The information notice is read ("Okudum, anladım"); explicit
 * consent is asked only for location history. A new version of either text is shown again.
 */
export const PRIVACY_NOTICE_VERSION = 1;
export const HISTORY_CONSENT_VERSION = 1;

const recordSchema = z
  .object({ version: z.number().int().positive(), at: z.number().int() })
  .strict()
  .nullable();

/** What the account has given: null when never (or, for consent, withdrawn). */
export const privacyStateSchema = z
  .object({ notice: recordSchema, history: recordSchema })
  .strict();
export type PrivacyState = z.infer<typeof privacyStateSchema>;

export const noticeReadSchema = z.object({ version: z.number().int().positive() }).strict();
export type NoticeRead = z.infer<typeof noticeReadSchema>;

/** The account's age band (docs/ADR/0023); `age` is null until the person said. */
export const ageStateSchema = z
  .object({
    age: z
      .object({ band: ageBandSchema, method: z.enum(AGE_METHODS), at: z.number().int() })
      .strict()
      .nullable(),
  })
  .strict();
export type AgeState = z.infer<typeof ageStateSchema>;

/** Saying it (once), or moving to 15-17; older than said takes a person or the age token. */
export const ageUpdateSchema = z.object({ band: ageBandSchema }).strict();
export type AgeUpdate = z.infer<typeof ageUpdateSchema>;

/** Gives (`given: true`, with the version shown) or withdraws explicit consent. */
export const historyConsentSchema = z
  .object({ given: z.boolean(), version: z.number().int().positive() })
  .strict();
export type HistoryConsent = z.infer<typeof historyConsentSchema>;

/**
 * What the server holds of the account, for "Verilerimi indir" (docs/ADR/0022). Encrypted copies
 * are not included: the phone adds what it can open itself.
 */
export const accountExportSchema = z
  .object({
    account: z
      .object({
        userId: z.uuid(),
        username: z.string().nullable(),
        displayName: z.string().nullable(),
        avatar: avatarSchema.nullable(),
        createdAt: z.number().int(),
      })
      .strict(),
    devices: z.array(
      z
        .object({
          platform: z.enum(PLATFORMS),
          createdAt: z.number().int(),
          lastSeenAt: z.number().int(),
          revokedAt: z.number().int().nullable(),
          revokedReason: z.string().nullable(),
        })
        .strict(),
    ),
    circles: z.array(
      z
        .object({
          id: z.uuid(),
          kind: z.enum(CIRCLE_KINDS),
          name: z.string().nullable(),
          role: z.enum(MEMBER_ROLES),
          status: z.enum(MEMBER_STATUSES),
          joinedAt: z.number().int().nullable(),
        })
        .strict(),
    ),
    securityEvents: z.array(
      z.object({ type: z.enum(SECURITY_EVENT_TYPES), at: z.number().int() }).strict(),
    ),
    passkeys: z.number().int().nonnegative(),
    pushRegistered: z.boolean(),
    historyPieces: z.number().int().nonnegative(),
    privacy: privacyStateSchema,
  })
  .strict();
export type AccountExport = z.infer<typeof accountExportSchema>;
