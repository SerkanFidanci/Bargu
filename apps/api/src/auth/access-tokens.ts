import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CryptoKey,
  errors,
  importJWK,
  jwtVerify,
  SignJWT,
  type JWTHeaderParameters,
} from 'jose';

import { ApiError } from '../common/api-error.js';
import { AuthKeys } from './auth-keys.js';

export const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const ISSUER = 'bargu-api';
const AUDIENCE = 'bargu-app';
const ALGORITHM = 'EdDSA';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AccessClaims {
  userId: string;
  deviceId: string;
  /** Refresh token family: revoking it ends this session at the next request. */
  sessionId: string;
}

/** Verified claims, with when the token stops being valid (Unix ms). */
export interface VerifiedClaims extends AccessClaims {
  expiresAt: number;
}

/** Short-lived EdDSA JWTs (BARGU_PLAN §3.2). Every request still checks device and session in DB. */
@Injectable()
export class AccessTokens {
  private readonly imported = new Map<string, Promise<CryptoKey>>();

  constructor(private readonly keys: AuthKeys) {}

  /** JWKs are imported once into non-extractable Web Crypto keys. */
  private key(kid: string, jwk: AuthKeys['signingKey']): Promise<CryptoKey> {
    const cached = this.imported.get(kid);
    if (cached !== undefined) return cached;
    const key = importJWK({ ...jwk }, ALGORITHM, { extractable: false }).then((imported) => {
      if (imported instanceof Uint8Array) throw new Error('expected an asymmetric key');
      return imported;
    });
    this.imported.set(kid, key);
    return key;
  }

  async issue(claims: AccessClaims): Promise<{ token: string; expiresAt: number }> {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ did: claims.deviceId, sid: claims.sessionId })
      .setProtectedHeader({ alg: ALGORITHM, typ: 'at+jwt', kid: this.keys.signingKeyId })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
      .sign(await this.key(`sign:${this.keys.signingKeyId}`, this.keys.signingKey));
    return { token, expiresAt: (now + ACCESS_TOKEN_TTL_SECONDS) * 1000 };
  }

  async verify(token: string): Promise<VerifiedClaims> {
    try {
      const { payload } = await jwtVerify(
        token,
        async (header: JWTHeaderParameters) => {
          const jwk =
            header.kid === undefined ? undefined : this.keys.verificationKeys.get(header.kid);
          if (header.kid === undefined || jwk === undefined) throw new errors.JWKSNoMatchingKey();
          return this.key(`verify:${header.kid}`, jwk);
        },
        {
          algorithms: [ALGORITHM],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: 'at+jwt',
          clockTolerance: 5,
          maxTokenAge: ACCESS_TOKEN_TTL_SECONDS + 5,
          requiredClaims: ['sub', 'did', 'sid', 'exp', 'iat'],
        },
      );
      const { sub, did, sid, exp } = payload;
      if (
        typeof sub !== 'string' ||
        typeof did !== 'string' ||
        typeof sid !== 'string' ||
        typeof exp !== 'number'
      ) {
        throw new errors.JWTClaimValidationFailed('claims', payload);
      }
      if (!UUID.test(sub) || !UUID.test(did) || !UUID.test(sid)) {
        throw new errors.JWTClaimValidationFailed('claims', payload);
      }
      return { userId: sub, deviceId: did, sessionId: sid, expiresAt: exp * 1000 };
    } catch (error) {
      if (error instanceof errors.JWTExpired) {
        throw new ApiError(HttpStatus.UNAUTHORIZED, 'TOKEN_EXPIRED');
      }
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    }
  }
}
