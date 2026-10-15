import { z } from 'zod';

import { deviceKeyBundleSchema } from './envelope.js';
import { avatarSchema } from './profile.js';

/** Request headers of a device-signed request (docs/PROTOCOL.md §12). */
export const SIGNED_REQUEST_HEADERS = {
  signature: 'x-bargu-sig',
  timestamp: 'x-bargu-ts',
  nonce: 'x-bargu-nonce',
  /** Only on requests without an access token (login), which carries the device otherwise. */
  device: 'x-bargu-device',
} as const;

export const LOCALES = ['tr', 'en'] as const;
export const localeSchema = z.enum(LOCALES);

/**
 * Age bands (docs/ADR/0023): Bargu is not for anyone under 15, and 15-17 gets stricter rules. Only
 * the band is kept, never a birth date. Declared now; later from the e-Devlet age token.
 */
export const AGE_BANDS = ['15-17', '18+'] as const;
export type AgeBand = (typeof AGE_BANDS)[number];
export const ageBandSchema = z.enum(AGE_BANDS);
export const AGE_METHODS = ['declared', 'token'] as const;

/** RFC 5321 limits the address to 254 octets; anything longer cannot be delivered. */
export const emailSchema = z.email().max(254);

/**
 * Asking for a login code. The challenge is bound to the identity key of the device that will log
 * in: only that key can redeem it, and wrong-code limits are counted per key, so a stranger cannot
 * burn a user's attempts (docs/ADR/0005).
 */
export const otpRequestSchema = z
  .object({
    email: emailSchema,
    locale: localeSchema,
    identityKey: z
      .string()
      .length(43)
      .regex(/^[A-Za-z0-9_-]*$/),
  })
  .strict();
export type OtpRequest = z.infer<typeof otpRequestSchema>;

export const otpChallengeSchema = z
  .object({
    challengeId: z.uuid(),
    /** Seconds until the code expires. */
    expiresIn: z.number().int().positive(),
  })
  .strict();
export type OtpChallenge = z.infer<typeof otpChallengeSchema>;

export const PLATFORMS = ['ios', 'android'] as const;

/** Platform attestation of the app instance (App Attest / Play Integrity), bound to a challenge. */
export const attestationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('app_attest'),
      challengeId: z.uuid(),
      /** App Attest key id (base64). */
      keyId: z.string().min(1).max(128),
      /** CBOR attestation object (base64). */
      attestation: z.string().min(1).max(16_384),
    })
    .strict(),
  z
    .object({
      type: z.literal('play_integrity'),
      challengeId: z.uuid(),
      token: z.string().min(1).max(16_384),
    })
    .strict(),
]);
export type Attestation = z.infer<typeof attestationSchema>;

/** A new device presenting its keys at login (one active device per account). */
export const deviceRegistrationSchema = z
  .object({
    platform: z.enum(PLATFORMS),
    bundle: deviceKeyBundleSchema,
    attestation: attestationSchema.optional(),
  })
  .strict();
export type DeviceRegistration = z.infer<typeof deviceRegistrationSchema>;

export const otpVerifySchema = z
  .object({
    challengeId: z.uuid(),
    code: z.string().regex(/^\d{4}$/),
    device: deviceRegistrationSchema,
    /** Asked before the email: required when the code opens a new account, ignored otherwise. */
    ageBand: ageBandSchema.optional(),
  })
  .strict();
export type OtpVerify = z.infer<typeof otpVerifySchema>;

export const refreshRequestSchema = z.object({ refreshToken: z.string().min(1).max(128) }).strict();
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const sessionSchema = z
  .object({
    userId: z.uuid(),
    deviceId: z.uuid(),
    accessToken: z.string(),
    /** Unix epoch milliseconds. */
    accessTokenExpiresAt: z.number().int(),
    refreshToken: z.string(),
    refreshTokenExpiresAt: z.number().int(),
    /** True when this login created the account (onboarding continues with a username). */
    isNewUser: z.boolean(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;

export const attestationChallengeSchema = z
  .object({ challengeId: z.uuid(), challenge: z.string(), expiresIn: z.number().int() })
  .strict();
export type AttestationChallenge = z.infer<typeof attestationChallengeSchema>;

export const meSchema = z
  .object({
    userId: z.uuid(),
    username: z.string().nullable(),
    displayName: z.string().nullable(),
    avatar: avatarSchema.nullable(),
    device: z.object({ id: z.uuid(), platform: z.enum(PLATFORMS), attested: z.boolean() }).strict(),
    passkeys: z.number().int().nonnegative(),
  })
  .strict();
export type Me = z.infer<typeof meSchema>;

/** What the security events list names (app.security_events); phones skip types they do not know. */
export const SECURITY_EVENT_TYPES = [
  'login_otp',
  'login_passkey',
  'device_replaced',
  'refresh_reuse',
  'passkey_added',
  'logout',
  /** Taken off the account from the web page (docs/ADR/0021). */
  'device_revoked_remote',
] as const;
/** How far back the list goes, and how many at most. */
export const SECURITY_EVENTS_DAYS = 90;
export const SECURITY_EVENTS_MAX = 100;

/**
 * One security event of the account (Faz 9): what happened and when, and on which kind of phone
 * (this one or another). No IP address, no place: the server keeps none.
 */
export const securityEventSchema = z
  .object({
    id: z.uuid(),
    type: z.enum(SECURITY_EVENT_TYPES),
    at: z.number().int(),
    device: z
      .object({ platform: z.enum(PLATFORMS), current: z.boolean() })
      .strict()
      .nullable(),
  })
  .strict();
export type SecurityEvent = z.infer<typeof securityEventSchema>;
/** The list as sent; each event is checked on its own by the phone. */
export const securityEventsSchema = z
  .object({ events: z.array(z.unknown()).max(SECURITY_EVENTS_MAX) })
  .strict();

/** WebAuthn JSON from the platform authenticator; verified field by field by the server library. */
const webAuthnResponseSchema = z
  .object({
    id: z.string().min(1).max(1024),
    rawId: z.string().min(1).max(1024),
    type: z.literal('public-key'),
    response: z.record(z.string(), z.unknown()),
    clientExtensionResults: z.record(z.string(), z.unknown()).default({}),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).optional(),
  })
  .loose();

export const passkeyRegisterVerifySchema = z
  .object({ challengeId: z.uuid(), response: webAuthnResponseSchema })
  .strict();
export type PasskeyRegisterVerify = z.infer<typeof passkeyRegisterVerifySchema>;

export const passkeyLoginVerifySchema = z
  .object({
    challengeId: z.uuid(),
    response: webAuthnResponseSchema,
    device: deviceRegistrationSchema,
  })
  .strict();
export type PasskeyLoginVerify = z.infer<typeof passkeyLoginVerifySchema>;

/** Error body of every non-2xx response: a stable machine-readable code, no internals. */
export const apiErrorSchema = z
  .object({ statusCode: z.number().int(), error: z.string(), code: z.string() })
  .strict();
export type ApiError = z.infer<typeof apiErrorSchema>;

/** This phone's push token (FCM on Android, APNs on iOS) and the language of its notices. */
export const pushRegistrationSchema = z
  .object({
    token: z.string().min(1).max(4096),
    platform: z.enum(PLATFORMS),
    locale: localeSchema,
  })
  .strict();
export type PushRegistration = z.infer<typeof pushRegistrationSchema>;
