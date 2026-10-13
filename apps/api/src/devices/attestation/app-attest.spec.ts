import { sha256 } from '@bargu/crypto';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  createAttestation,
  createTestCa,
  type AttestationOptions,
  type TestCa,
} from '../../../test/support/app-attest-fixture.js';
import {
  APPLE_APP_ATTEST_ROOT_PEM,
  APPLE_APP_ATTEST_ROOT_SHA256,
  certificateSha256,
  verifyAppAttest,
} from './app-attest.js';

const appId = 'ABCDE12345.app.bargu';
const clientDataHash = sha256(new TextEncoder().encode('challenge+identity-key'));
let ca: TestCa;
let otherCa: TestCa;

beforeAll(async () => {
  [ca, otherCa] = await Promise.all([createTestCa(), createTestCa()]);
});

async function verify(
  options: Partial<AttestationOptions> = {},
  config: {
    appId?: string;
    environment?: 'development' | 'production';
    root?: TestCa;
    now?: Date;
  } = {},
) {
  const attestation = await createAttestation(ca, {
    appId,
    environment: 'production',
    clientDataHash,
    ...options,
  });
  const at = config.now;
  return verifyAppAttest(
    { ...attestation, clientDataHash },
    {
      appId: config.appId ?? appId,
      environment: config.environment ?? 'production',
      rootPem: (config.root ?? ca).rootPem,
      ...(at === undefined ? {} : { now: () => at }),
    },
  );
}

describe('App Attest verification', () => {
  it('pins the real Apple root certificate', () => {
    expect(certificateSha256(APPLE_APP_ATTEST_ROOT_PEM)).toBe(APPLE_APP_ATTEST_ROOT_SHA256);
  });

  it('accepts a genuine attestation', async () => {
    expect(await verify()).toBe(true);
    expect(await verify({ environment: 'development' }, { environment: 'development' })).toBe(true);
  });

  it.each([
    ['a chain from another root', {}, { root: undefined as TestCa | undefined }],
    ['another app', {}, { appId: 'ZZZZZ99999.app.other' }],
    ['a development key in production', { environment: 'development' as const }, {}],
    ['expired certificates', {}, { now: new Date(Date.now() + 400 * 24 * 3600 * 1000) }],
  ])('rejects %s', async (_, options, config) => {
    const resolved = 'root' in config ? { ...config, root: otherCa } : config;
    expect(await verify(options, resolved)).toBe(false);
  });

  it.each([
    ['a used key (counter above zero)', { counter: 1 }],
    ['a missing nonce extension', { omitNonce: true }],
    ['a nonce for other data', { wrongNonce: true }],
    ['a key id that is not the key', { wrongKeyId: true }],
    ['another attestation format', { fmt: 'packed' }],
  ])('rejects %s', async (_, options) => {
    expect(await verify(options)).toBe(false);
  });

  it('rejects data attested for a different challenge or device key', async () => {
    const attestation = await createAttestation(ca, {
      appId,
      environment: 'production',
      clientDataHash,
    });
    const other = sha256(new TextEncoder().encode('another challenge'));
    expect(
      await verifyAppAttest(
        { ...attestation, clientDataHash: other },
        { appId, environment: 'production', rootPem: ca.rootPem },
      ),
    ).toBe(false);
  });

  it('never throws on garbage', async () => {
    expect(
      await verifyAppAttest(
        { keyId: 'AA==', attestation: 'not cbor', clientDataHash },
        { appId, environment: 'production', rootPem: ca.rootPem },
      ),
    ).toBe(false);
  });
});
