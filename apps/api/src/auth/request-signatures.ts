import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { REQUEST_MAX_SKEW_MS, verifyRequestSignature } from '@bargu/crypto';
import { SIGNED_REQUEST_HEADERS } from '@bargu/schemas';

import { ApiError } from '../common/api-error.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import type { AuthedRequest } from './request-context.js';

const NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TIMESTAMP_PATTERN = /^\d{1,16}$/;
/** Nonces are remembered a little longer than the accepted clock window on either side. */
const NONCE_TTL_SECONDS = Math.ceil((2 * REQUEST_MAX_SKEW_MS) / 1000) + 10;

function header(request: AuthedRequest, name: string): string | undefined {
  const value = request.headers[name];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Device-signed requests (BARGU_PLAN §3.2): Ed25519 over method, path, time, nonce, device and
 * body hash (packages/crypto `signRequest`). A stolen access or refresh token is useless without
 * the device's identity key, which never leaves the phone's keystore.
 */
@Injectable()
export class RequestSignatures {
  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  async verify(request: AuthedRequest, deviceId: string, identityKey: Uint8Array): Promise<void> {
    // A parsed body that was not captured raw would be unsigned; never accept that.
    const unsignedBody =
      request.rawBody === undefined && request.body !== undefined && request.body !== null;
    if (unsignedBody) throw new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_INVALID');
    await this.verifyParts(
      {
        method: request.method,
        path: request.url,
        body: request.rawBody ?? new Uint8Array(0),
        signature: header(request, SIGNED_REQUEST_HEADERS.signature),
        timestamp: header(request, SIGNED_REQUEST_HEADERS.timestamp),
        nonce: header(request, SIGNED_REQUEST_HEADERS.nonce),
      },
      deviceId,
      identityKey,
    );
  }

  /**
   * The same check for a signature that did not arrive in HTTP headers (the WebSocket handshake
   * carries it in its auth payload). Unknown types count as missing.
   */
  async verifyParts(
    parts: {
      method: string;
      path: string;
      body: Uint8Array;
      signature: unknown;
      timestamp: unknown;
      nonce: unknown;
    },
    deviceId: string,
    identityKey: Uint8Array,
  ): Promise<void> {
    const { signature, timestamp, nonce } = parts;
    if (
      typeof signature !== 'string' ||
      typeof timestamp !== 'string' ||
      typeof nonce !== 'string'
    ) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_REQUIRED');
    }
    const time = TIMESTAMP_PATTERN.test(timestamp) ? Number(timestamp) : Number.NaN;
    if (Number.isFinite(time) && Math.abs(Date.now() - time) > REQUEST_MAX_SKEW_MS) {
      // Distinct from a bad signature: the app corrects its clock from the Date header and retries.
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'CLOCK_SKEW');
    }
    if (
      !NONCE_PATTERN.test(nonce) ||
      !Number.isFinite(time) ||
      !verifyRequestSignature(
        identityKey,
        {
          method: parts.method,
          path: parts.path,
          timestamp: time,
          nonce,
          deviceId,
          body: parts.body,
        },
        signature,
      )
    ) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_INVALID');
    }
    // Each signed request is accepted once: a captured request cannot be replayed in the window.
    const fresh = await this.redis.set(`nonce:${deviceId}:${nonce}`, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: NONCE_TTL_SECONDS },
    });
    if (fresh !== 'OK') throw new ApiError(HttpStatus.UNAUTHORIZED, 'SIGNATURE_INVALID');
  }
}
