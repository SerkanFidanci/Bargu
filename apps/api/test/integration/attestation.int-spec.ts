import type { DeviceKeys } from '@bargu/crypto';
import type { AttestationChallenge, Me, Session } from '@bargu/schemas';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { attestedDataHash } from '../../src/devices/attestation/attestation.service.js';
import { createAttestation, createTestCa, type TestCa } from '../support/app-attest-fixture.js';
import { createTestApp, testEnv, type TestApp } from './support/app.js';
import {
  call,
  codeFor,
  newDevice,
  registration,
  requestCode,
  wrongCode,
  uniqueEmail,
} from './support/client.js';

const APP_ID = 'ABCDE12345.app.bargu';
let ca: TestCa;
let test: TestApp;

beforeAll(async () => {
  ca = await createTestCa();
  test = await createTestApp({
    env: testEnv({ DEVICE_ATTESTATION: 'required', IOS_APP_ID: APP_ID }),
    verifiers: {
      appAttest: { appId: APP_ID, environment: 'production', rootPem: ca.rootPem },
      // Stands in for Google's decode API: accepts only the expected request hash.
      playIntegrity: {
        verify: (token, hash) =>
          Promise.resolve(
            token === 'outage' ? 'unavailable' : token === `good:${hash}` ? 'valid' : 'invalid',
          ),
      },
    },
  });
});
afterAll(async () => {
  await test.close();
});

async function challenge(): Promise<AttestationChallenge> {
  const response = await call(test.app, { url: '/v1/auth/attestation/challenge' });
  return response.json<AttestationChallenge>();
}

async function appAttest(device: DeviceKeys) {
  const { challengeId, challenge: value } = await challenge();
  const hash = attestedDataHash(Buffer.from(value, 'base64url'), device.identity.publicKey);
  const attestation = await createAttestation(ca, {
    appId: APP_ID,
    environment: 'production',
    clientDataHash: hash,
  });
  return { type: 'app_attest' as const, challengeId, ...attestation };
}

async function verify(device: DeviceKeys, device_: object, code?: string, challengeId?: string) {
  const otp = challengeId ?? (await requestCode(test, uniqueEmail(), device)).challengeId;
  return call(test.app, {
    url: '/v1/auth/otp/verify',
    body: { challengeId: otp, code: code ?? codeFor(test, otp), device: device_ },
    device,
  });
}

describe('device attestation (DEVICE_ATTESTATION=required)', () => {
  it('refuses an unattested device', async () => {
    const device = newDevice();
    const response = await verify(device, registration(device, 'ios'));
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'ATTESTATION_REQUIRED' });
  });

  it('accepts an iPhone with a valid App Attest attestation of its own key', async () => {
    const device = newDevice();
    const attestation = await appAttest(device);
    const response = await verify(device, { ...registration(device, 'ios'), attestation });
    expect(response.statusCode).toBe(200);
    const me = await call(test.app, {
      method: 'GET',
      url: '/v1/me',
      accessToken: response.json<Session>().accessToken,
    });
    expect(me.json<Me>().device).toMatchObject({ platform: 'ios', attested: true });
  });

  it('refuses an attestation made for another device key', async () => {
    const device = newDevice();
    const attestation = await appAttest(newDevice());
    const response = await verify(device, { ...registration(device, 'ios'), attestation });
    expect(response.json()).toMatchObject({ code: 'ATTESTATION_INVALID' });
  });

  it('refuses App Attest on Android and an unknown challenge', async () => {
    const device = newDevice();
    const attestation = await appAttest(device);
    const onAndroid = await verify(device, { ...registration(device, 'android'), attestation });
    expect(onAndroid.json()).toMatchObject({ code: 'ATTESTATION_INVALID' });
    const unknown = await verify(device, {
      ...registration(device, 'ios'),
      attestation: { ...attestation, challengeId: '0190f7a4-0000-7000-8000-000000000000' },
    });
    expect(unknown.json()).toMatchObject({ code: 'ATTESTATION_INVALID' });
  });

  it('keeps the attestation across a wrong code, then consumes it on success', async () => {
    const device = newDevice();
    const attestation = await appAttest(device);
    const reg = { ...registration(device, 'ios'), attestation };
    const { challengeId } = await requestCode(test, uniqueEmail(), device);
    const right = codeFor(test, challengeId);
    const wrong = wrongCode(right);
    expect((await verify(device, reg, wrong, challengeId)).json()).toMatchObject({
      code: 'OTP_INVALID',
    });
    expect((await verify(device, reg, right, challengeId)).statusCode).toBe(200);
    // App Attest attests a key once; its challenge cannot be replayed for another login.
    const again = await verify(device, reg);
    expect(again.statusCode).toBe(403);
    expect(again.json()).toMatchObject({ code: 'ATTESTATION_INVALID' });
  });

  it('accepts an Android device with a Play Integrity verdict for its key', async () => {
    const device = newDevice();
    const { challengeId, challenge: value } = await challenge();
    const hash = Buffer.from(
      attestedDataHash(Buffer.from(value, 'base64url'), device.identity.publicKey),
    ).toString('base64url');
    const good = await verify(device, {
      ...registration(device, 'android'),
      attestation: { type: 'play_integrity', challengeId, token: `good:${hash}` },
    });
    expect(good.statusCode).toBe(200);

    const other = newDevice();
    const { challengeId: second } = await challenge();
    const bad = await verify(other, {
      ...registration(other, 'android'),
      attestation: { type: 'play_integrity', challengeId: second, token: 'forged' },
    });
    expect(bad.json()).toMatchObject({ code: 'ATTESTATION_INVALID' });
  });

  it('answers 503, not "invalid device", when Google cannot be reached', async () => {
    const device = newDevice();
    const { challengeId } = await challenge();
    const response = await verify(device, {
      ...registration(device, 'android'),
      attestation: { type: 'play_integrity', challengeId, token: 'outage' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'UNAVAILABLE' });
  });
});
