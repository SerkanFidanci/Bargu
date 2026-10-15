import {
  deriveOtpCode,
  exportDeviceKeyBundle,
  generateDeviceKeys,
  generateRequestNonce,
  randomUuid,
  signRequest,
  toBase64url,
  type DeviceKeys,
} from '@bargu/crypto';
import {
  type AgeBand,
  SIGNED_REQUEST_HEADERS,
  type OtpChallenge,
  type Session,
} from '@bargu/schemas';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { Response } from 'light-my-request';

import type { TestApp } from './app.js';

let ipCounter = 0;
/** A distinct client address per call site, so per-IP rate limits of one test never hit another. */
export function nextIp(): string {
  ipCounter += 1;
  return `10.${String((ipCounter >> 16) & 255)}.${String((ipCounter >> 8) & 255)}.${String(ipCounter & 255)}`;
}

export function newDevice(): DeviceKeys {
  return generateDeviceKeys(randomUuid());
}

export function registration(device: DeviceKeys, platform: 'ios' | 'android' = 'android') {
  return { platform, bundle: exportDeviceKeyBundle(device) };
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  body?: unknown;
  /** Signs the request with this device's identity key. */
  device?: DeviceKeys;
  accessToken?: string;
  ip?: string;
  /** Override parts of the signature (tests of the verifier). */
  sign?: { timestamp?: number; nonce?: string; signer?: DeviceKeys };
}

/** Sends a request the way the app will: JSON body, optional bearer token and device signature. */
export async function call(app: NestFastifyApplication, options: CallOptions): Promise<Response> {
  const method = options.method ?? 'POST';
  const payload = options.body === undefined ? undefined : JSON.stringify(options.body);
  const headers: Record<string, string> = {};
  if (payload !== undefined) headers['content-type'] = 'application/json';
  if (options.accessToken !== undefined) headers.authorization = `Bearer ${options.accessToken}`;
  if (options.device !== undefined) {
    const timestamp = options.sign?.timestamp ?? Date.now();
    const nonce = options.sign?.nonce ?? generateRequestNonce();
    const signer = options.sign?.signer ?? options.device;
    headers[SIGNED_REQUEST_HEADERS.signature] = signRequest(signer.identity.secretKey, {
      method,
      path: options.url,
      timestamp,
      nonce,
      deviceId: options.device.deviceId,
      body: new TextEncoder().encode(payload ?? ''),
    });
    headers[SIGNED_REQUEST_HEADERS.timestamp] = String(timestamp);
    headers[SIGNED_REQUEST_HEADERS.nonce] = nonce;
  }
  return app.inject({
    method,
    url: options.url,
    headers,
    remoteAddress: options.ip ?? nextIp(),
    ...(payload === undefined ? {} : { payload }),
  });
}

/** Asks for a login code for `device` (the challenge is bound to its identity key). */
export async function requestCode(
  test: TestApp,
  email: string,
  device: DeviceKeys = newDevice(),
  ip = nextIp(),
): Promise<OtpChallenge> {
  const response = await requestCodeRaw(test, email, device, ip);
  if (response.statusCode !== 202) throw new Error(`otp request: ${response.body}`);
  return response.json<OtpChallenge>();
}

export function requestCodeRaw(
  test: TestApp,
  email: string,
  device: DeviceKeys,
  ip = nextIp(),
): Promise<Response> {
  return call(test.app, {
    url: '/v1/auth/otp/request',
    body: { email, locale: 'tr', identityKey: toBase64url(device.identity.publicKey) },
    ip,
  });
}

/** A valid-looking code that is not the right one. */
export const wrongCode = (code: string) =>
  String((Number(code) + 1) % 100_000_000).padStart(code.length, '0');

/** The code the worker would email: tests hold the OTP key, so they derive it like the worker. */
export function codeFor(test: TestApp, challengeId: string): string {
  return deriveOtpCode(test.env.OTP_KEY, challengeId);
}

/** Signs in (a new address opens an account, 18+ unless said otherwise: docs/ADR/0023). */
export async function login(
  test: TestApp,
  email: string,
  device: DeviceKeys = newDevice(),
  ageBand: AgeBand = '18+',
): Promise<{ session: Session; device: DeviceKeys }> {
  const { challengeId } = await requestCode(test, email, device);
  const response = await call(test.app, {
    url: '/v1/auth/otp/verify',
    body: {
      challengeId,
      code: codeFor(test, challengeId),
      device: registration(device),
      ageBand,
    },
    device,
  });
  if (response.statusCode !== 200) throw new Error(`otp verify: ${response.body}`);
  return { session: response.json<Session>(), device };
}

export const uniqueEmail = () => `user-${randomUuid()}@example.test`;
