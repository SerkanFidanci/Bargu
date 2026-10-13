import { existsSync } from 'node:fs';
import { z } from 'zod';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

const ipAddress = z.union([z.ipv4(), z.ipv6()]);
const proxyAddress = z.union([z.ipv4(), z.ipv6(), z.cidrv4(), z.cidrv6()]);

const commaSeparated = z
  .string()
  .optional()
  .transform((value) =>
    (value ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

/** A 32-byte secret as unpadded base64url (generate with `openssl rand 32 | basenc --base64url`). */
const secretKey = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}=?$/, 'expected 32 bytes as base64url')
  .transform((value) => new Uint8Array(Buffer.from(value.replace(/=$/, ''), 'base64url')));

/** SHA-256 certificate fingerprint, `AA:BB:…` or plain hex; normalised to upper-case `AA:BB:…`. */
const certFingerprint = z
  .string()
  .transform((value) => value.replaceAll(':', '').toUpperCase())
  .pipe(z.string().regex(/^[0-9A-F]{64}$/, 'expected a SHA-256 fingerprint'))
  .transform((hex) => hex.match(/../g)?.join(':') ?? hex);

/** WebAuthn origins: the HTTPS site and the Android app (`android:apk-key-hash:…`). */
const ANDROID_ORIGIN = /^android:apk-key-hash:[A-Za-z0-9_-]{43}$/;
const webAuthnOrigin = z.string().refine((value) => {
  if (ANDROID_ORIGIN.test(value)) return true;
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  const local = url.protocol === 'http:' && url.hostname === 'localhost';
  // An origin only: scheme, host and optional port, nothing else.
  return (url.protocol === 'https:' || local) && url.origin === value;
}, 'expected an https origin or android:apk-key-hash:…');

/** Java-style package name: lower-case segments separated by dots, at least two segments. */
const PACKAGE_SEGMENT = /^[a-z][a-z0-9_]*$/;
const androidPackage = z
  .string()
  .max(255)
  .refine((value) => {
    const segments = value.split('.');
    return segments.length >= 2 && segments.every((segment) => PACKAGE_SEGMENT.test(segment));
  }, 'expected a package name such as app.bargu');

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** Where this runs; decides which shortcuts are allowed (staging may skip attestation). */
    APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
    HOST: ipAddress.default('127.0.0.1'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    /** Runtime role (bargu_app): no table ownership, no RLS bypass. */
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    REDIS_URL: z.url({ protocol: /^rediss?$/ }),
    /** Reverse proxies whose X-Forwarded-* headers are trusted (IP or CIDR, comma separated). */
    TRUST_PROXY: commaSeparated.pipe(z.array(proxyAddress)),

    /** Ed25519 seed for access tokens. Rotate by moving the old public key to the next variable. */
    JWT_SIGNING_KEY: secretKey,
    /** Raw 32-byte public key of the previous signing key, accepted until its tokens expire. */
    JWT_PREVIOUS_PUBLIC_KEY: secretKey.optional(),
    /** Derives login codes; rotating it invalidates only codes in flight. */
    OTP_KEY: secretKey,
    /** Keyed hash of email addresses. Never rotate: accounts are found by it. */
    EMAIL_LOOKUP_KEY: secretKey,
    /** Seals sensitive job payloads at rest (email addresses in the queue). */
    JOB_PAYLOAD_KEY: secretKey,

    SMTP_URL: z.url({ protocol: /^smtps?$/ }),
    MAIL_FROM: z.string().min(3).max(200),

    /** Passkey relying party: the registrable domain the app is associated with. */
    WEBAUTHN_RP_ID: z.string().regex(/^[a-z0-9.-]+$/),
    WEBAUTHN_RP_NAME: z.string().min(1).default('Bargu'),
    WEBAUTHN_ORIGINS: commaSeparated.pipe(z.array(webAuthnOrigin).min(1)),

    ANDROID_PACKAGE: androidPackage.default('app.bargu'),
    /** Signing certificates of the Android app (assetlinks.json, Play Integrity check). */
    ANDROID_CERT_SHA256: commaSeparated.pipe(z.array(certFingerprint)),
    /** `TEAMID.bundle.id` (apple-app-site-association, App Attest). */
    IOS_APP_ID: z
      .string()
      .regex(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/)
      .optional(),

    /**
     * off: ignore attestation; optional: verify when sent (staging, until the store accounts
     * exist); required: refuse devices without a valid attestation (production).
     */
    DEVICE_ATTESTATION: z.enum(['off', 'optional', 'required']).default('optional'),
    APP_ATTEST_ENVIRONMENT: z.enum(['development', 'production']).default('production'),
    /** Google service account JSON (base64) allowed to call the Play Integrity API. */
    PLAY_INTEGRITY_SERVICE_ACCOUNT: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // A production build without an explicit APP_ENV would silently get development shortcuts.
    if (
      env.NODE_ENV === 'production' &&
      env.APP_ENV !== 'staging' &&
      env.APP_ENV !== 'production'
    ) {
      ctx.addIssue({ code: 'custom', path: ['APP_ENV'], message: 'must be staging or production' });
    }
    if (env.APP_ENV !== 'production') return;
    const need = (ok: boolean, path: string, message: string) => {
      if (!ok) ctx.addIssue({ code: 'custom', path: [path], message });
    };
    need(env.NODE_ENV === 'production', 'NODE_ENV', 'must be production');
    need(env.DEVICE_ATTESTATION === 'required', 'DEVICE_ATTESTATION', 'must be required');
    need(env.IOS_APP_ID !== undefined, 'IOS_APP_ID', 'is required in production');
    need(env.ANDROID_CERT_SHA256.length > 0, 'ANDROID_CERT_SHA256', 'is required in production');
    need(
      env.PLAY_INTEGRITY_SERVICE_ACCOUNT !== undefined,
      'PLAY_INTEGRITY_SERVICE_ACCOUNT',
      'is required in production',
    );
    need(
      env.WEBAUTHN_ORIGINS.every((origin) => !origin.startsWith('http://')),
      'WEBAUTHN_ORIGINS',
      'must not contain http origins',
    );
  });

export type Env = z.infer<typeof envSchema>;

export class InvalidEnvError extends Error {
  override readonly name = 'InvalidEnvError';
}

/**
 * Validates the environment. Error messages name the variable and the rule that failed but never
 * echo the value, because values such as DATABASE_URL carry credentials.
 */
export function parseEnv(source: NodeJS.ProcessEnv): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new InvalidEnvError(`Invalid environment configuration:\n${details}`);
  }
  return result.data;
}

/**
 * Loads `.env` from the working directory when present (local development only; containers get
 * their environment from the orchestrator), then validates. Variables already set in the process
 * environment take precedence over the file.
 */
export function loadEnv(): Env {
  if (existsSync('.env')) {
    process.loadEnvFile('.env');
  }
  return parseEnv(process.env);
}
