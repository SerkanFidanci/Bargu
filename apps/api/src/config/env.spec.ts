import { describe, expect, it } from 'vitest';

import { billingTestOn, InvalidEnvError, parseEnv } from './env.js';

const key = (fill: string) => fill.repeat(43);
const base = {
  DATABASE_URL: 'postgres://user:s3cret-pass@localhost:5432/bargu',
  REDIS_URL: 'redis://default:s3cret-pass@localhost:6379',
  JWT_SIGNING_KEY: key('a'),
  OTP_KEY: key('b'),
  EMAIL_LOOKUP_KEY: key('c'),
  JOB_PAYLOAD_KEY: key('d'),
  SMTP_URL: 'smtp://127.0.0.1:1025',
  MAIL_FROM: 'Bargu <no-reply@bargu.test>',
  WEBAUTHN_RP_ID: 'bargu.test',
  WEBAUTHN_ORIGINS: 'https://bargu.test',
};

const production = {
  ...base,
  NODE_ENV: 'production',
  APP_ENV: 'production',
  DEVICE_ATTESTATION: 'required',
  IOS_APP_ID: 'ABCDE12345.app.bargu',
  ANDROID_CERT_SHA256: 'ab'.repeat(32),
  PLAY_INTEGRITY_SERVICE_ACCOUNT: 'e30=',
};

describe('parseEnv', () => {
  it('applies safe defaults', () => {
    const env = parseEnv(base);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: [],
    });
  });

  it('coerces and validates values', () => {
    const env = parseEnv({
      ...base,
      PORT: '8080',
      HOST: '0.0.0.0',
      NODE_ENV: 'production',
      APP_ENV: 'staging',
    });
    expect(env.PORT).toBe(8080);
    expect(env.HOST).toBe('0.0.0.0');
    expect(env.NODE_ENV).toBe('production');
  });

  it('parses the trusted proxy list', () => {
    const env = parseEnv({ ...base, TRUST_PROXY: ' 172.30.0.0/24, 10.0.0.1 ,' });
    expect(env.TRUST_PROXY).toEqual(['172.30.0.0/24', '10.0.0.1']);
  });

  it.each([
    ['missing DATABASE_URL', { REDIS_URL: base.REDIS_URL }],
    ['non-postgres DATABASE_URL', { ...base, DATABASE_URL: 'mysql://u:p@localhost/db' }],
    ['non-redis REDIS_URL', { ...base, REDIS_URL: 'http://localhost:6379' }],
    ['out of range PORT', { ...base, PORT: '70000' }],
    ['unknown LOG_LEVEL', { ...base, LOG_LEVEL: 'verbose' }],
    ['hostname as HOST', { ...base, HOST: 'localhost' }],
    ['invalid TRUST_PROXY entry', { ...base, TRUST_PROXY: 'caddy' }],
    ['short secret key', { ...base, OTP_KEY: key('a').slice(1) }],
    ['non-SMTP mail URL', { ...base, SMTP_URL: 'https://mail.example' }],
    ['origin with a path', { ...base, WEBAUTHN_ORIGINS: 'https://bargu.test/login' }],
    ['plain http origin', { ...base, WEBAUTHN_ORIGINS: 'http://bargu.test' }],
    ['short android key hash', { ...base, WEBAUTHN_ORIGINS: 'android:apk-key-hash:abc' }],
    ['account page origin with a path', { ...base, WEB_ORIGIN: 'https://bargu.test/hesap' }],
    [
      'account page on an app origin',
      { ...base, WEB_ORIGIN: 'android:apk-key-hash:' + 'A'.repeat(43) },
    ],
    ['single-segment package', { ...base, ANDROID_PACKAGE: 'bargu' }],
    ['bad certificate fingerprint', { ...base, ANDROID_CERT_SHA256: 'AB:CD' }],
    ['production without attestation', { ...production, DEVICE_ATTESTATION: 'optional' }],
    ['production without iOS app id', { ...production, IOS_APP_ID: undefined }],
    [
      'production without Play Integrity',
      { ...production, PLAY_INTEGRITY_SERVICE_ACCOUNT: undefined },
    ],
    ['production without app certificates', { ...production, ANDROID_CERT_SHA256: '' }],
    [
      'production routing test mail elsewhere',
      { ...production, SMTP_TEST_URL: 'smtp://mailpit:1025' },
    ],
    [
      'production with a localhost origin',
      { ...production, WEBAUTHN_ORIGINS: 'http://localhost:8081' },
    ],
    ['production with test purchases on', { ...production, BILLING_TEST: 'on' }],
    [
      'production with a localhost account page',
      { ...production, WEB_ORIGIN: 'http://localhost:3000' },
    ],
    ['production outside NODE_ENV=production', { ...production, NODE_ENV: 'development' }],
    // A production build must say where it runs, or it would silently get development shortcuts.
    ['NODE_ENV=production without APP_ENV', { ...base, NODE_ENV: 'production' }],
  ])('rejects %s', (_, source) => {
    expect(() => parseEnv(source)).toThrow(InvalidEnvError);
  });

  it('decodes secrets and normalises fingerprints and origins', () => {
    const env = parseEnv({
      ...base,
      ANDROID_CERT_SHA256: 'ab'.repeat(32),
      WEBAUTHN_ORIGINS: `https://bargu.test, android:apk-key-hash:${'A'.repeat(43)}, http://localhost:8081`,
    });
    expect(env.OTP_KEY).toHaveLength(32);
    expect(env.ANDROID_CERT_SHA256).toEqual([Array(32).fill('AB').join(':')]);
    expect(env.WEBAUTHN_ORIGINS).toHaveLength(3);
    expect(env.DEVICE_ATTESTATION).toBe('optional');
    expect(parseEnv(production).APP_ENV).toBe('production');
  });

  it('names the failing variable without echoing secret values', () => {
    const source = { ...base, DATABASE_URL: 'mysql://user:s3cret-pass@localhost/db' };
    let message = '';
    try {
      parseEnv(source);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).toContain('DATABASE_URL');
    expect(message).not.toContain('s3cret-pass');
  });

  it('turns test purchases on everywhere but production, unless said (docs/ADR/0024)', () => {
    expect(billingTestOn(parseEnv(base))).toBe(true);
    expect(billingTestOn(parseEnv({ ...base, BILLING_TEST: 'off' }))).toBe(false);
    expect(billingTestOn(parseEnv(production))).toBe(false);
    expect(billingTestOn(parseEnv({ ...production, BILLING_TEST: 'off' }))).toBe(false);
  });
});
