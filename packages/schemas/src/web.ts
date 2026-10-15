import { z } from 'zod';

import { emailSchema, localeSchema, PLATFORMS } from './auth.js';

/**
 * The account web page (docs/ADR/0021): someone without their phone (lost, stolen) takes it off
 * their account with a code sent to their email. The page makes a random `binding` and keeps it;
 * the code works only with it, so a code read elsewhere is of no use.
 */
const bindingSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]*$/);

/**
 * What a browser that once came in with a code keeps (QA 4 K2): it is not held back by the ceiling
 * every network together has for one address, so someone who only knows the address cannot lock
 * its owner out from many networks. It gives no access by itself.
 */
const rememberSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]*$/);

export const webCodeRequestSchema = z
  .object({
    email: emailSchema,
    locale: localeSchema,
    binding: bindingSchema,
    remember: rememberSchema.optional(),
  })
  .strict();
export type WebCodeRequest = z.infer<typeof webCodeRequestSchema>;

/** The same answer whether or not the address has an account. */
export const webChallengeSchema = z
  .object({ challengeId: z.uuid(), expiresIn: z.number().int() })
  .strict();
export type WebChallenge = z.infer<typeof webChallengeSchema>;

export const webCodeVerifySchema = z
  .object({
    challengeId: z.uuid(),
    code: z.string().regex(/^\d{8}$/),
    binding: bindingSchema,
    remember: rememberSchema.optional(),
  })
  .strict();
export type WebCodeVerify = z.infer<typeof webCodeVerifySchema>;

/** A short session of the page: what the account has, and the token for its one action. */
export const webSessionSchema = z
  .object({
    token: z.string(),
    expiresIn: z.number().int(),
    /** The phone signed in now, if any. */
    device: z
      .object({ platform: z.enum(PLATFORMS), since: z.number().int() })
      .strict()
      .nullable(),
    /** For this browser to keep (see rememberSchema). */
    remember: rememberSchema,
  })
  .strict();
export type WebSession = z.infer<typeof webSessionSchema>;

/**
 * The "recognise this browser" link emailed when the address's ceilings are full (QA 4 K2b): its
 * id and the secret beside it. Opening it makes the browser a known one; it opens nothing else.
 */
export const webUnlockSchema = z
  .object({
    id: z.uuid(),
    token: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]*$/),
  })
  .strict();
export type WebUnlock = z.infer<typeof webUnlockSchema>;

export const webUnlockedSchema = z.object({ remember: rememberSchema }).strict();
export type WebUnlocked = z.infer<typeof webUnlockedSchema>;

export const webRevokeSchema = z
  .object({
    token: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]*$/),
  })
  .strict();
export type WebRevoke = z.infer<typeof webRevokeSchema>;
