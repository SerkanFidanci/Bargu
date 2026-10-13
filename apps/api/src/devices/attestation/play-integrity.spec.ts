import { beforeAll, describe, expect, it, vi } from 'vitest';

import { PlayIntegrityVerifier } from './play-integrity.js';

const NOW = 1_791_880_000_000;
const FINGERPRINT = Array(32).fill('AB').join(':');
const DIGEST = Buffer.from('AB'.repeat(32), 'hex').toString('base64url');

let serviceAccount: string;
beforeAll(async () => {
  const keys = await globalThis.crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: Uint8Array.of(1, 0, 1),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = Buffer.from(await globalThis.crypto.subtle.exportKey('pkcs8', keys.privateKey));
  const pem = `-----BEGIN PRIVATE KEY-----\n${pkcs8.toString('base64')}\n-----END PRIVATE KEY-----\n`;
  serviceAccount = Buffer.from(
    JSON.stringify({ client_email: 'verifier@bargu-test.iam.example', private_key: pem }),
  ).toString('base64');
});

function verdict(overrides: {
  packageName?: string;
  requestHash?: string;
  timestampMillis?: number;
  recognition?: string;
  digests?: string[];
  device?: string[];
}) {
  return {
    tokenPayloadExternal: {
      requestDetails: {
        requestPackageName: overrides.packageName ?? 'app.bargu',
        requestHash: overrides.requestHash ?? 'expected-hash',
        timestampMillis: String(overrides.timestampMillis ?? NOW - 1_000),
      },
      appIntegrity: {
        appRecognitionVerdict: overrides.recognition ?? 'PLAY_RECOGNIZED',
        packageName: overrides.packageName ?? 'app.bargu',
        certificateSha256Digest: overrides.digests ?? [DIGEST],
      },
      deviceIntegrity: { deviceRecognitionVerdict: overrides.device ?? ['MEETS_DEVICE_INTEGRITY'] },
    },
  };
}

type FetchTarget = string | URL | Request;
const targetOf = (url: FetchTarget) =>
  typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;

function fakeGoogle(decoded: unknown, status = 200) {
  return vi.fn((url: FetchTarget) => {
    const target = targetOf(url);
    if (target.startsWith('https://oauth2.googleapis.com/token')) {
      return Promise.resolve(Response.json({ access_token: 'google-token', expires_in: 3600 }));
    }
    return Promise.resolve(Response.json(decoded, { status }));
  });
}

function verifier(fetch: ReturnType<typeof fakeGoogle>) {
  return new PlayIntegrityVerifier({
    packageName: 'app.bargu',
    certificateFingerprints: [FINGERPRINT],
    serviceAccount,
    fetch,
    now: () => NOW,
  });
}

describe('Play Integrity verification', () => {
  it('accepts a fresh verdict for our signed app on a genuine device', async () => {
    const fetch = fakeGoogle(verdict({}));
    const subject = verifier(fetch);
    expect(await subject.verify('integrity-token', 'expected-hash')).toBe('valid');
    expect(await subject.verify('integrity-token', 'expected-hash')).toBe('valid');
    // The OAuth token is fetched once and reused until it nears expiry.
    const tokenCalls = fetch.mock.calls.filter(([url]) => targetOf(url).includes('oauth2'));
    expect(tokenCalls).toHaveLength(1);
    const decodeCall = fetch.mock.calls.find(([url]) => targetOf(url).includes('playintegrity'));
    expect(decodeCall === undefined ? '' : targetOf(decodeCall[0])).toBe(
      'https://playintegrity.googleapis.com/v1/app.bargu:decodeIntegrityToken',
    );
  });

  it.each([
    ['another package', { packageName: 'com.evil' }],
    ['a different request hash', { requestHash: 'other' }],
    ['a stale verdict', { timestampMillis: NOW - 10 * 60 * 1000 }],
    ['a verdict from the future', { timestampMillis: NOW + 5 * 60 * 1000 }],
    ['an unrecognised build', { recognition: 'UNRECOGNIZED_VERSION' }],
    ['another signing certificate', { digests: [Buffer.alloc(32).toString('base64url')] }],
    ['a device without integrity', { device: ['MEETS_BASIC_INTEGRITY'] }],
  ])('rejects %s', async (_, overrides) => {
    expect(await verifier(fakeGoogle(verdict(overrides))).verify('t', 'expected-hash')).toBe(
      'invalid',
    );
  });

  it('fails closed when Google rejects the token or answers nonsense', async () => {
    expect(await verifier(fakeGoogle(verdict({}), 400)).verify('t', 'expected-hash')).toBe(
      'invalid',
    );
    expect(await verifier(fakeGoogle({ unexpected: true })).verify('t', 'expected-hash')).toBe(
      'invalid',
    );
  });

  it('reports an outage as unavailable, not as an invalid device', async () => {
    expect(await verifier(fakeGoogle(verdict({}), 503)).verify('t', 'expected-hash')).toBe(
      'unavailable',
    );
    const tokenFails = vi.fn(() => Promise.resolve(new Response('denied', { status: 401 })));
    expect(await verifier(tokenFails).verify('t', 'expected-hash')).toBe('unavailable');
    const offline = vi.fn(() => Promise.reject(new TypeError('fetch failed')));
    expect(await verifier(offline).verify('t', 'expected-hash')).toBe('unavailable');
  });
});
