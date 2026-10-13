import { describe, expect, it } from 'vitest';

import {
  attestationSchema,
  deviceRegistrationSchema,
  otpRequestSchema,
  otpVerifySchema,
  passkeyLoginVerifySchema,
  refreshRequestSchema,
} from './index.js';

const uuid = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';
const b64 = (bytes: number) => 'A'.repeat(Math.ceil((bytes * 4) / 3));
const device = {
  platform: 'android',
  bundle: { deviceId: uuid, identityKey: b64(32), dhKey: b64(32), dhKeySignature: b64(64) },
};

describe('auth schemas', () => {
  it('accept well-formed requests', () => {
    expect(otpRequestSchema.parse({ email: 'ali@example.com', locale: 'tr' })).toBeTruthy();
    expect(otpVerifySchema.parse({ challengeId: uuid, code: '012345', device })).toBeTruthy();
    expect(
      deviceRegistrationSchema.parse({
        ...device,
        attestation: { type: 'play_integrity', challengeId: uuid, token: 'x' },
      }),
    ).toBeTruthy();
    expect(refreshRequestSchema.parse({ refreshToken: 'abc' })).toBeTruthy();
    expect(
      passkeyLoginVerifySchema.parse({
        challengeId: uuid,
        device,
        response: { id: 'a', rawId: 'a', type: 'public-key', response: {} },
      }).response.clientExtensionResults,
    ).toEqual({});
  });

  it.each([
    ['an invalid email', otpRequestSchema, { email: 'not-an-email', locale: 'tr' }],
    ['an over-long email', otpRequestSchema, { email: `${'a'.repeat(250)}@x.co`, locale: 'tr' }],
    ['an unknown locale', otpRequestSchema, { email: 'a@b.co', locale: 'de' }],
    ['a five-digit code', otpVerifySchema, { challengeId: uuid, code: '12345', device }],
    ['a non-numeric code', otpVerifySchema, { challengeId: uuid, code: '12345a', device }],
    ['an unknown platform', deviceRegistrationSchema, { ...device, platform: 'web' }],
    ['an extra field', refreshRequestSchema, { refreshToken: 'a', userId: uuid }],
    ['an unknown attestation', attestationSchema, { type: 'safetynet', challengeId: uuid }],
  ])('reject %s', (_, schema, value) => {
    expect(schema.safeParse(value).success).toBe(false);
  });
});
