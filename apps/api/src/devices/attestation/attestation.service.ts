import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { generateToken, randomUuid, sha256 } from '@bargu/crypto';
import type { AttestationChallenge, DeviceRegistration } from '@bargu/schemas';

import { ApiError } from '../../common/api-error.js';
import { ENV } from '../../config/config.module.js';
import type { Env } from '../../config/env.js';
import { REDIS, type RedisClient } from '../../infra/redis/redis.client.js';
import {
  APPLE_APP_ATTEST_ROOT_PEM,
  APPLE_APP_ATTEST_ROOT_SHA256,
  certificateSha256,
  verifyAppAttest,
  type AppAttestConfig,
} from './app-attest.js';
import { PlayIntegrityVerifier } from './play-integrity.js';

export const ATTESTATION_CHALLENGE_TTL_SECONDS = 5 * 60;
export type AttestationKind = 'app_attest' | 'play_integrity';

/** Replaced in tests: a test CA instead of Apple's, a fake Google API. */
export const ATTESTATION_VERIFIERS = Symbol('ATTESTATION_VERIFIERS');
export interface AttestationVerifiers {
  appAttest?: AppAttestConfig;
  playIntegrity?: Pick<PlayIntegrityVerifier, 'verify'>;
}

export function createAttestationVerifiers(env: Env): AttestationVerifiers {
  if (certificateSha256(APPLE_APP_ATTEST_ROOT_PEM) !== APPLE_APP_ATTEST_ROOT_SHA256) {
    throw new Error('Apple App Attest root certificate does not match its pinned fingerprint');
  }
  return {
    ...(env.IOS_APP_ID === undefined
      ? {}
      : {
          appAttest: {
            appId: env.IOS_APP_ID,
            environment: env.APP_ATTEST_ENVIRONMENT,
            rootPem: APPLE_APP_ATTEST_ROOT_PEM,
          },
        }),
    ...(env.PLAY_INTEGRITY_SERVICE_ACCOUNT === undefined
      ? {}
      : {
          playIntegrity: new PlayIntegrityVerifier({
            packageName: env.ANDROID_PACKAGE,
            certificateFingerprints: env.ANDROID_CERT_SHA256,
            serviceAccount: env.PLAY_INTEGRITY_SERVICE_ACCOUNT,
          }),
        }),
  };
}

/**
 * What the platform attests: SHA-256(challenge ‖ identity key). The attestation therefore vouches
 * for this exact device key, not just for "some genuine app".
 */
export function attestedDataHash(challenge: Uint8Array, identityKey: Uint8Array): Uint8Array {
  const data = new Uint8Array(challenge.length + identityKey.length);
  data.set(challenge);
  data.set(identityKey, challenge.length);
  return sha256(data);
}

/**
 * App Attest (iOS) and Play Integrity (Android) at device registration (BARGU_PLAN §3.2).
 * DEVICE_ATTESTATION decides what happens without one: `required` refuses the device, `optional`
 * accepts it unattested (staging, until the store accounts exist). A present but invalid
 * attestation is always refused.
 */
@Injectable()
export class AttestationService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: RedisClient,
    @Inject(ATTESTATION_VERIFIERS) private readonly verifiers: AttestationVerifiers,
  ) {}

  async createChallenge(): Promise<AttestationChallenge> {
    const challengeId = randomUuid();
    const challenge = generateToken();
    await this.redis.set(`att:${challengeId}`, challenge, {
      expiration: { type: 'EX', value: ATTESTATION_CHALLENGE_TTL_SECONDS },
    });
    return { challengeId, challenge, expiresIn: ATTESTATION_CHALLENGE_TTL_SECONDS };
  }

  /** Returns the kind of attestation that passed, or null for an accepted unattested device. */
  async verify(
    registration: DeviceRegistration,
    identityKey: Uint8Array,
  ): Promise<AttestationKind | null> {
    const mode = this.env.DEVICE_ATTESTATION;
    const { attestation, platform } = registration;
    if (mode === 'off') return null;
    if (attestation === undefined) {
      if (mode === 'required') throw new ApiError(HttpStatus.FORBIDDEN, 'ATTESTATION_REQUIRED');
      return null;
    }
    const invalid = new ApiError(HttpStatus.FORBIDDEN, 'ATTESTATION_INVALID');

    // Read, not consumed: App Attest can attest a key only once, so a login that fails for another
    // reason (a wrong code) must be able to retry with the same attestation. The login deletes the
    // challenge once it succeeds (`consume`); it is bound to this device key either way.
    const challenge = await this.redis.get(`att:${attestation.challengeId}`);
    if (challenge === null) throw invalid;
    const dataHash = attestedDataHash(Buffer.from(challenge, 'base64url'), identityKey);

    if (attestation.type === 'app_attest') {
      const config = this.verifiers.appAttest;
      if (platform !== 'ios' || config === undefined) throw invalid;
      const ok = await verifyAppAttest(
        {
          keyId: attestation.keyId,
          attestation: attestation.attestation,
          clientDataHash: dataHash,
        },
        config,
      );
      if (!ok) throw invalid;
      return 'app_attest';
    }

    const verifier = this.verifiers.playIntegrity;
    if (platform !== 'android' || verifier === undefined) throw invalid;
    const requestHash = Buffer.from(dataHash).toString('base64url');
    if (!(await verifier.verify(attestation.token, requestHash))) throw invalid;
    return 'play_integrity';
  }

  async consume(registration: DeviceRegistration): Promise<void> {
    if (registration.attestation !== undefined) {
      await this.redis.del(`att:${registration.attestation.challengeId}`);
    }
  }
}
