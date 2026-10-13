import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUuid } from '@bargu/crypto';
import type { PasskeyLoginVerify, PasskeyRegisterVerify } from '@bargu/schemas';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { eq } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { isUniqueViolation } from '../devices/device-registry.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { passkeys, securityEvents, users } from '../db/schema.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import type { AuthContext } from './request-context.js';

export const PASSKEY_CHALLENGE_TTL_SECONDS = 5 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const userIdBytes = (userId: string) =>
  new Uint8Array(Buffer.from(userId.replaceAll('-', ''), 'hex'));
function userIdFromHandle(handle: string | undefined): string | null {
  if (handle === undefined) return null;
  const hex = Buffer.from(handle, 'base64url').toString('hex');
  const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return UUID.test(id) ? id : null;
}

/**
 * Passkeys (BARGU_PLAN §1: primary login). Discoverable credentials with user verification; the
 * WebAuthn user handle is the account id, so a login resolves the account without any lookup
 * across users. Challenges are single use and live 5 minutes in Redis.
 */

const logger = new Logger('Passkeys');

/** COSE algorithm ids offered at registration: Ed25519, ES256 (P-256), RS256. */
export const PASSKEY_ALGORITHMS = [-8, -7, -257];

/**
 * Refuses a passkey operation with the one public code, and logs why for diagnosis. The reason and
 * the verifier's message (format, origin, RP ID, challenge) carry no account data or key material.
 */
function rejected(status: HttpStatus, reason: string, error?: unknown): ApiError {
  const detail = error instanceof Error ? `: ${error.message.slice(0, 200)}` : '';
  logger.warn(`passkey rejected (${reason})${detail}`);
  return new ApiError(status, 'PASSKEY_INVALID');
}

@Injectable()
export class PasskeysService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly database: DatabaseService,
  ) {}

  async registrationOptions(
    auth: AuthContext,
  ): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const { username, displayName, existing } = await this.database.asUser(
      auth.userId,
      async (tx) => {
        const [user] = await tx
          .select({ username: users.username, displayName: users.displayName })
          .from(users);
        const rows = await tx
          .select({ id: passkeys.credentialId, transports: passkeys.transports })
          .from(passkeys);
        return {
          username: user?.username ?? null,
          displayName: user?.displayName ?? null,
          existing: rows,
        };
      },
    );
    const options = await generateRegistrationOptions({
      rpName: this.env.WEBAUTHN_RP_NAME,
      rpID: this.env.WEBAUTHN_RP_ID,
      userName: username ?? 'Bargu',
      // Shown in the phone's passkey list; Android's passkey providers refuse an empty one.
      userDisplayName: displayName ?? username ?? 'Bargu',
      userID: userIdBytes(auth.userId),
      // Algorithms every platform authenticator implements. The library's default also offers
      // ML-DSA (-48), which some Android passkey providers reject outright instead of skipping.
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      excludeCredentials: existing.map((row) => ({
        id: Buffer.from(row.id).toString('base64url'),
        transports: row.transports,
      })),
    });
    const challengeId = await this.storeChallenge('reg', `${auth.userId}:${options.challenge}`);
    return { challengeId, options };
  }

  async register(auth: AuthContext, body: PasskeyRegisterVerify): Promise<void> {
    const stored = await this.takeChallenge('reg', body.challengeId);
    const [owner, challenge] = stored?.split(':') ?? [];
    if (owner !== auth.userId || challenge === undefined) {
      throw rejected(
        HttpStatus.BAD_REQUEST,
        'registration challenge unknown, expired or not yours',
      );
    }
    let verified;
    try {
      verified = await verifyRegistrationResponse({
        response: body.response as unknown as RegistrationResponseJSON,
        expectedChallenge: challenge,
        expectedOrigin: this.env.WEBAUTHN_ORIGINS,
        expectedRPID: this.env.WEBAUTHN_RP_ID,
        requireUserVerification: true,
        supportedAlgorithmIDs: PASSKEY_ALGORITHMS,
      });
    } catch (error) {
      throw rejected(HttpStatus.BAD_REQUEST, 'registration response invalid', error);
    }
    if (!verified.verified) throw rejected(HttpStatus.BAD_REQUEST, 'registration not verified');
    const { credential, credentialBackedUp } = verified.registrationInfo;
    try {
      await this.database.asUser(auth.userId, async (tx) => {
        await tx.insert(passkeys).values({
          credentialId: new Uint8Array(Buffer.from(credential.id, 'base64url')),
          userId: auth.userId,
          publicKey: credential.publicKey,
          counter: credential.counter,
          transports: credential.transports ?? [],
          backedUp: credentialBackedUp,
        });
        await tx
          .insert(securityEvents)
          .values({ userId: auth.userId, type: 'passkey_added', deviceId: auth.deviceId });
      });
    } catch (error) {
      // The authenticator already registered this credential (here or for another account).
      if (isUniqueViolation(error))
        throw rejected(HttpStatus.CONFLICT, 'credential already registered');
      throw error;
    }
  }

  async loginOptions(): Promise<{
    challengeId: string;
    options: PublicKeyCredentialRequestOptionsJSON;
  }> {
    const options = await generateAuthenticationOptions({
      rpID: this.env.WEBAUTHN_RP_ID,
      userVerification: 'required',
    });
    const challengeId = await this.storeChallenge('auth', options.challenge);
    return { challengeId, options };
  }

  /**
   * Verifies a passkey assertion inside the login transaction and returns the account id. The
   * caller opens `asUser` with the id from the user handle; the credential lookup then runs under
   * that account's row-level security, so a forged handle finds nothing.
   */
  async verifyLogin(tx: Tx, body: PasskeyLoginVerify, challenge: string): Promise<void> {
    const response = body.response as unknown as AuthenticationResponseJSON;
    const credentialId = new Uint8Array(Buffer.from(response.id, 'base64url'));
    const [row] = await tx.select().from(passkeys).where(eq(passkeys.credentialId, credentialId));
    if (row === undefined) throw rejected(HttpStatus.UNAUTHORIZED, 'credential not registered');
    let verified;
    try {
      verified = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: this.env.WEBAUTHN_ORIGINS,
        expectedRPID: this.env.WEBAUTHN_RP_ID,
        credential: {
          id: response.id,
          publicKey: new Uint8Array(row.publicKey),
          counter: row.counter,
          transports: row.transports,
        },
        requireUserVerification: true,
      });
    } catch (error) {
      throw rejected(HttpStatus.UNAUTHORIZED, 'assertion invalid', error);
    }
    if (!verified.verified) throw rejected(HttpStatus.UNAUTHORIZED, 'assertion not verified');
    await tx
      .update(passkeys)
      .set({ counter: verified.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(passkeys.credentialId, credentialId));
  }

  /** Consumes a login challenge and reads the account id the assertion claims. */
  async takeLoginChallenge(
    body: PasskeyLoginVerify,
  ): Promise<{ userId: string; challenge: string }> {
    const challenge = await this.takeChallenge('auth', body.challengeId);
    const handle = (body.response.response as { userHandle?: unknown }).userHandle;
    const userId = userIdFromHandle(typeof handle === 'string' ? handle : undefined);
    if (challenge === null || userId === null) {
      throw rejected(HttpStatus.UNAUTHORIZED, 'login challenge unknown or user handle unreadable');
    }
    return { userId, challenge };
  }

  private async storeChallenge(kind: 'reg' | 'auth', value: string): Promise<string> {
    const challengeId = randomUuid();
    await this.redis.set(`wa:${kind}:${challengeId}`, value, {
      expiration: { type: 'EX', value: PASSKEY_CHALLENGE_TTL_SECONDS },
    });
    return challengeId;
  }

  private takeChallenge(kind: 'reg' | 'auth', challengeId: string): Promise<string | null> {
    return this.redis.getDel(`wa:${kind}:${challengeId}`);
  }
}
