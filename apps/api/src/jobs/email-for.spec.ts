import { deriveOtpCode, deriveWebCode, randomUuid, verifyWebUnlockToken } from '@bargu/crypto';
import { describe, expect, it } from 'vitest';

import { webOriginOf } from '../config/env.js';
import { emailFor } from './email.worker.js';

const otpKey = new Uint8Array(32).fill(7);
const to = 'ayse@example.test';

describe('the emails of the queue', () => {
  it('carry the code derived from the challenge, in the body only', () => {
    const challengeId = randomUuid();
    const login = emailFor({ kind: 'otp', to, locale: 'tr', challengeId }, otpKey, null);
    expect(login?.text).toContain(deriveOtpCode(otpKey, challengeId));
    expect(login?.subject).not.toContain(deriveOtpCode(otpKey, challengeId));
    const web = emailFor({ kind: 'web', to, locale: 'en', challengeId }, otpKey, null);
    expect(web?.text).toContain(deriveWebCode(otpKey, challengeId));
  });

  it('link the account page with the secret after the "#" (QA 4 K2b)', () => {
    const challengeId = randomUuid();
    const job = { kind: 'web-unlock', to, locale: 'tr', challengeId } as const;
    const email = emailFor(job, otpKey, 'https://bargu.test');
    const link = /https:\/\/bargu\.test\/hesap#unlock=([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})/.exec(
      email?.text ?? '',
    );
    expect(link?.[1]).toBe(challengeId);
    expect(verifyWebUnlockToken(otpKey, challengeId, link?.[2] ?? '')).toBe(true);
    expect(email?.subject).not.toContain(link?.[2] ?? '-');
    // With nowhere to point to, no email rather than a broken link.
    expect(emailFor(job, otpKey, null)).toBeNull();
  });

  it('point to the web origin set, else the first web origin of the passkeys', () => {
    const origins = ['android:apk-key-hash:' + 'A'.repeat(43), 'https://api.bargu.test'];
    expect(webOriginOf({ WEB_ORIGIN: undefined, WEBAUTHN_ORIGINS: origins })).toBe(
      'https://api.bargu.test',
    );
    expect(webOriginOf({ WEB_ORIGIN: 'https://bargu.test', WEBAUTHN_ORIGINS: origins })).toBe(
      'https://bargu.test',
    );
    expect(webOriginOf({ WEB_ORIGIN: undefined, WEBAUTHN_ORIGINS: [origins[0] ?? ''] })).toBeNull();
  });
});
