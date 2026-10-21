import { createHash, createHmac } from 'node:crypto';

import { safeIdSchema } from '@bargu/schemas';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { openAtRest, sealAtRest } from '../src/at-rest.js';
import {
  deriveOtpCode,
  deriveWebCode,
  deriveWebUnlockToken,
  emailLookupKey,
  generateMessageId,
  generateRequestNonce,
  generateToken,
  hashToken,
  normalizeEmail,
  pseudonym,
  signRequest,
  verifyOtpCode,
  verifyWebCode,
  verifyWebUnlockToken,
  WEB_CODE_DIGITS,
  verifyRequestSignature,
  type RequestToSign,
} from '../src/auth.js';
import { fromBase64url, toBase64url, utf8Encode, uuidToBytes } from '../src/encoding.js';
import { BarguCryptoError } from '../src/errors.js';
import { ids, testDevice } from './helpers.js';

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof BarguCryptoError) return error.code;
    throw error;
  }
  return 'NO_ERROR';
}

const device = testDevice(ids.aliceDevice, 1);
const other = testDevice(ids.bobDevice, 3);
const key = new Uint8Array(32).fill(0x5a);

const request: RequestToSign = {
  method: 'POST',
  path: '/v1/auth/refresh?x=1',
  timestamp: 1_791_880_000_000,
  nonce: toBase64url(new Uint8Array(16).fill(7)),
  deviceId: ids.aliceDevice,
  body: utf8Encode('{"refreshToken":"abc"}'),
};

describe('request signatures', () => {
  it('verify for the signing device only', () => {
    const signature = signRequest(device.identity.secretKey, request);
    expect(verifyRequestSignature(device.identity.publicKey, request, signature)).toBe(true);
    expect(verifyRequestSignature(other.identity.publicKey, request, signature)).toBe(false);
  });

  it('pin the byte format (Ed25519 is deterministic)', () => {
    // Changing the signed message layout breaks every client: bump the label instead.
    expect(signRequest(device.identity.secretKey, request)).toBe(
      signRequest(device.identity.secretKey, { ...request }),
    );
    expect(signRequest(device.identity.secretKey, request)).toMatchInlineSnapshot(
      `"Hyb7iIzqI-Nf4q0hXGFieX0tZehHGwD35bnZJPp8swWnR_eiO5tTtigjDRhks4lZ07Wr2HGG-eRJmxv53ggoCQ"`,
    );
  });

  it.each([
    ['method', { method: 'GET' }],
    ['path', { path: '/v1/auth/refresh?x=2' }],
    ['timestamp', { timestamp: request.timestamp + 1 }],
    ['nonce', { nonce: toBase64url(new Uint8Array(16).fill(8)) }],
    ['device', { deviceId: ids.bobDevice }],
    ['body', { body: utf8Encode('{"refreshToken":"abd"}') }],
  ])('reject a changed %s', (_, change) => {
    const signature = signRequest(device.identity.secretKey, request);
    expect(
      verifyRequestSignature(device.identity.publicKey, { ...request, ...change }, signature),
    ).toBe(false);
  });

  it('round-trip arbitrary paths and bodies (property)', () => {
    fc.assert(
      fc.property(
        fc.string({ maxLength: 300 }),
        fc.uint8Array({ maxLength: 500 }),
        (suffix, body) => {
          const signed = { ...request, path: `/${suffix}`, body };
          const signature = signRequest(device.identity.secretKey, signed);
          expect(verifyRequestSignature(device.identity.publicKey, signed, signature)).toBe(true);
        },
      ),
      { numRuns: 50 },
    );
  });

  it.each([
    ['lower-case method', { method: 'post' }],
    ['relative path', { path: 'v1/x' }],
    ['over-long path', { path: `/${'a'.repeat(2048)}` }],
    ['fractional timestamp', { timestamp: 1.5 }],
    ['negative timestamp', { timestamp: -1 }],
    ['short nonce', { nonce: toBase64url(new Uint8Array(15)) }],
    ['non-canonical device id', { deviceId: ids.aliceDevice.toUpperCase() }],
  ])('refuse to sign and never verify a %s', (_, change) => {
    const bad = { ...request, ...change };
    expect(codeOf(() => signRequest(device.identity.secretKey, bad))).toBe('MALFORMED');
    const signature = signRequest(device.identity.secretKey, request);
    expect(verifyRequestSignature(device.identity.publicKey, bad, signature)).toBe(false);
  });

  it('reject malformed signatures without throwing', () => {
    expect(verifyRequestSignature(device.identity.publicKey, request, 'not base64!')).toBe(false);
    expect(
      verifyRequestSignature(device.identity.publicKey, request, toBase64url(new Uint8Array(63))),
    ).toBe(false);
  });

  it('use fresh 16-byte nonces', () => {
    expect(fromBase64url(generateRequestNonce())).toHaveLength(16);
    expect(generateRequestNonce()).not.toBe(generateRequestNonce());
  });

  it('use fresh 16-byte message ids that the schema accepts (docs/ADR/0029)', () => {
    const id = generateMessageId();
    expect(fromBase64url(id)).toHaveLength(16);
    expect(safeIdSchema.safeParse(id).success).toBe(true);
    expect(generateMessageId()).not.toBe(id);
  });
});

describe('one-time codes', () => {
  const challenge = '0190f7a4-3333-7333-8333-000000000001';

  it('match an independent HMAC-SHA256 computation', () => {
    const mac = createHmac('sha256', key)
      .update(Buffer.concat([Buffer.from('bargu/v1/otp\0'), uuidToBytes(challenge)]))
      .digest();
    const expected = String(mac.readUIntBE(0, 6) % 10_000).padStart(4, '0');
    expect(deriveOtpCode(key, challenge)).toBe(expected);
  });

  it('are four digits and differ per challenge and key (property)', () => {
    fc.assert(
      fc.property(fc.uuid({ version: 7 }), (id) => {
        const code = deriveOtpCode(key, id);
        expect(code).toMatch(/^\d{4}$/);
        expect(verifyOtpCode(key, id, code)).toBe(true);
      }),
      { numRuns: 100 },
    );
    expect(deriveOtpCode(key, challenge)).not.toBe(deriveOtpCode(key, ids.circle));
    expect(deriveOtpCode(new Uint8Array(32).fill(1), challenge)).not.toBe(
      deriveOtpCode(key, challenge),
    );
  });

  it('verify only the exact code', () => {
    const code = deriveOtpCode(key, challenge);
    const wrong = String((Number(code) + 1) % 100_000_000).padStart(8, '0');
    expect(verifyOtpCode(key, challenge, wrong)).toBe(false);
    expect(verifyOtpCode(key, challenge, `${code}0`)).toBe(false);
    expect(verifyOtpCode(key, challenge, '')).toBe(false);
  });

  it('require a 32-byte key', () => {
    expect(codeOf(() => deriveOtpCode(new Uint8Array(16), challenge))).toBe('INVALID_KEY');
    expect(codeOf(() => deriveWebCode(new Uint8Array(16), challenge))).toBe('INVALID_KEY');
  });
});

describe('account web page codes (docs/ADR/0021)', () => {
  const challenge = '0190f7a4-3333-7333-8333-000000000002';

  it('match an independent HMAC-SHA256 computation under their own label', () => {
    const mac = createHmac('sha256', key)
      .update(Buffer.concat([Buffer.from('bargu/v1/web-code\0'), uuidToBytes(challenge)]))
      .digest();
    const expected = String(mac.readUIntBE(0, 6) % 100_000_000).padStart(8, '0');
    expect(deriveWebCode(key, challenge)).toBe(expected);
    expect(WEB_CODE_DIGITS).toBe(8);
  });

  it('are eight digits, and never a login code for the same challenge (property)', () => {
    fc.assert(
      fc.property(fc.uuid({ version: 7 }), (id) => {
        const code = deriveWebCode(key, id);
        expect(code).toMatch(/^\d{8}$/);
        expect(verifyWebCode(key, id, code)).toBe(true);
        expect(verifyOtpCode(key, id, code)).toBe(false);
        expect(verifyWebCode(key, id, deriveOtpCode(key, id))).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it('verify only the exact code', () => {
    const code = deriveWebCode(key, challenge);
    const wrong = String((Number(code) + 1) % 100_000_000).padStart(8, '0');
    expect(verifyWebCode(key, challenge, wrong)).toBe(false);
    expect(verifyWebCode(key, challenge, code.slice(1))).toBe(false);
    expect(verifyWebCode(key, challenge, '')).toBe(false);
  });
});

describe('account web page unlock links (QA 4 K2b)', () => {
  const unlockId = '0190f7a4-3333-7333-8333-000000000003';

  it('match an independent HMAC-SHA256 computation under their own label', () => {
    const mac = createHmac('sha256', key)
      .update(Buffer.concat([Buffer.from('bargu/v1/web-unlock\0'), uuidToBytes(unlockId)]))
      .digest();
    expect(deriveWebUnlockToken(key, unlockId)).toBe(mac.toString('base64url'));
    expect(deriveWebUnlockToken(key, unlockId)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('verify only the exact secret of the same link', () => {
    const token = deriveWebUnlockToken(key, unlockId);
    expect(verifyWebUnlockToken(key, unlockId, token)).toBe(true);
    expect(verifyWebUnlockToken(key, '0190f7a4-3333-7333-8333-000000000004', token)).toBe(false);
    expect(verifyWebUnlockToken(key, unlockId, token.slice(1))).toBe(false);
    expect(verifyWebUnlockToken(key, unlockId, '')).toBe(false);
    expect(codeOf(() => deriveWebUnlockToken(new Uint8Array(16), unlockId))).toBe('INVALID_KEY');
  });
});

describe('email lookup keys', () => {
  it('normalise case, whitespace and Unicode form', () => {
    expect(normalizeEmail('  Ali.Veli@Example.COM ')).toBe('ali.veli@example.com');
    expect(normalizeEmail('É@x.tr')).toBe(normalizeEmail('É@x.tr'));
  });

  it('match an independent HMAC-SHA256 computation and ignore case', () => {
    const expected = createHmac('sha256', key)
      .update(Buffer.concat([Buffer.from('bargu/v1/email\0'), Buffer.from('ali@example.com')]))
      .digest();
    expect(Buffer.from(emailLookupKey(key, 'Ali@Example.com'))).toEqual(expected);
    expect(emailLookupKey(new Uint8Array(32).fill(1), 'ali@example.com')).not.toEqual(
      emailLookupKey(key, 'ali@example.com'),
    );
    expect(codeOf(() => emailLookupKey(new Uint8Array(31), 'a@b.c'))).toBe('INVALID_KEY');
  });
});

describe('pseudonyms', () => {
  it('are keyed, separated by purpose and match an independent HMAC', () => {
    const value = pseudonym(key, 'ip', '203.0.113.7');
    const expected = createHmac('sha256', key)
      .update(Buffer.from('bargu/v1/pseudonym\x00ip\x00203.0.113.7'))
      .digest()
      .subarray(0, 16)
      .toString('hex');
    expect(value).toBe(expected);
    expect(pseudonym(key, 'device', '203.0.113.7')).not.toBe(value);
    expect(pseudonym(new Uint8Array(32).fill(1), 'ip', '203.0.113.7')).not.toBe(value);
    expect(codeOf(() => pseudonym(new Uint8Array(8), 'ip', 'x'))).toBe('INVALID_KEY');
  });
});

describe('tokens', () => {
  it('are 256-bit random strings stored only as a labelled SHA-256', () => {
    const token = generateToken();
    expect(fromBase64url(token)).toHaveLength(32);
    expect(token).not.toBe(generateToken());
    const expected = createHash('sha256').update(`bargu/v1/token\0${token}`).digest();
    expect(Buffer.from(hashToken(token))).toEqual(expected);
  });
});

describe('data at rest', () => {
  const plaintext = utf8Encode('ali@example.com');

  it('round-trips and uses a fresh nonce each time', () => {
    const a = sealAtRest(key, plaintext, 'job/email');
    expect(openAtRest(key, a, 'job/email')).toEqual(plaintext);
    expect(sealAtRest(key, plaintext, 'job/email')).not.toBe(a);
  });

  it('binds the purpose and rejects tampering or the wrong key', () => {
    const sealed = sealAtRest(key, plaintext, 'job/email');
    expect(codeOf(() => openAtRest(key, sealed, 'job/push'))).toBe('DECRYPT_FAILED');
    expect(codeOf(() => openAtRest(new Uint8Array(32), sealed, 'job/email'))).toBe(
      'DECRYPT_FAILED',
    );
    const bytes = fromBase64url(sealed);
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 1;
    expect(codeOf(() => openAtRest(key, toBase64url(bytes), 'job/email'))).toBe('DECRYPT_FAILED');
  });

  it('rejects malformed input and wrong key sizes', () => {
    const bytes = fromBase64url(sealAtRest(key, plaintext, 'x'));
    bytes[0] = 2;
    expect(codeOf(() => openAtRest(key, toBase64url(bytes), 'x'))).toBe('MALFORMED');
    expect(codeOf(() => openAtRest(key, toBase64url(new Uint8Array(40)), 'x'))).toBe('MALFORMED');
    expect(codeOf(() => sealAtRest(new Uint8Array(16), plaintext, 'x'))).toBe('INVALID_KEY');
    expect(codeOf(() => openAtRest(new Uint8Array(16), 'AA', 'x'))).toBe('INVALID_KEY');
  });
});
