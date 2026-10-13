import { HttpStatus, Injectable } from '@nestjs/common';
import { bytesEqual, generateToken, hashToken, randomUuid } from '@bargu/crypto';
import type { Session } from '@bargu/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { devices, refreshTokens, securityEvents } from '../db/schema.js';
import { DeviceLifecycle } from '../devices/device-lifecycle.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { AccessTokens } from './access-tokens.js';
import type { AuthContext, AuthedRequest } from './request-context.js';
import { RequestSignatures } from './request-signatures.js';

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;
/**
 * A rotated token presented again within this window, while its successor is still unused, is a
 * retry after a lost response (mobile networks), not theft: the chain continues from it once.
 */
export const REFRESH_RETRY_GRACE_MS = 30_000;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const REFRESH_TOKEN = new RegExp(`^rt1\\.(${UUID})\\.(${UUID})\\.([A-Za-z0-9_-]{43})$`);

interface IssuedRefresh {
  id: string;
  token: string;
  expiresAt: Date;
}

/**
 * Login sessions (BARGU_PLAN §3.2): EdDSA access token (10 min) + opaque refresh token rotated on
 * every use. Refresh tokens are stored only as hashes and are bound to the device: using one also
 * needs the device's signature. Reusing a rotated token outside the retry grace revokes the whole
 * family. Format `rt1.<userId>.<tokenId>.<secret>`: the user id lets the lookup run under that
 * user's row-level security; the secret is what is checked.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly accessTokens: AccessTokens,
    private readonly signatures: RequestSignatures,
    private readonly lifecycle: DeviceLifecycle,
  ) {}

  /** Starts a new refresh family for a freshly logged-in device. Runs inside `asUser`. */
  async start(
    tx: Tx,
    userId: string,
    deviceId: string,
    isNewUser: boolean,
  ): Promise<Omit<Session, 'accessToken' | 'accessTokenExpiresAt'> & { familyId: string }> {
    const familyId = randomUuid();
    const refresh = await this.insertRefresh(tx, userId, deviceId, familyId);
    return {
      userId,
      deviceId,
      familyId,
      refreshToken: refresh.token,
      refreshTokenExpiresAt: refresh.expiresAt.getTime(),
      isNewUser,
    };
  }

  /** Adds the access token once the login transaction has committed. */
  async complete(
    started: Omit<Session, 'accessToken' | 'accessTokenExpiresAt'> & { familyId: string },
  ): Promise<Session> {
    const access = await this.accessTokens.issue({
      userId: started.userId,
      deviceId: started.deviceId,
      sessionId: started.familyId,
    });
    return {
      userId: started.userId,
      deviceId: started.deviceId,
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt,
      refreshToken: started.refreshToken,
      refreshTokenExpiresAt: started.refreshTokenExpiresAt,
      isNewUser: started.isNewUser,
    };
  }

  async refresh(refreshToken: string, request: AuthedRequest): Promise<Session> {
    const match = REFRESH_TOKEN.exec(refreshToken);
    const [, userId, tokenId] = match ?? [];
    if (userId === undefined || tokenId === undefined) {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'REFRESH_INVALID');
    }
    const now = new Date();

    const outcome = await this.database.asUser(userId, async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.id, tokenId))
        .for('update');
      if (row === undefined || !bytesEqual(row.tokenHash, hashToken(refreshToken))) {
        return { kind: 'invalid' } as const;
      }
      const [device] = await tx
        .select({ identityKey: devices.identityKey, revokedAt: devices.revokedAt })
        .from(devices)
        .where(eq(devices.id, row.deviceId));
      if (device?.revokedAt !== null) return { kind: 'invalid' } as const;
      // Proof of possession before any state changes: a stolen token alone does nothing.
      await this.signatures.verify(request, row.deviceId, device.identityKey);

      if (row.revokedAt !== null || row.expiresAt <= now) return { kind: 'invalid' } as const;
      if (row.usedAt !== null) {
        const retry = await this.retrySuccessor(tx, row.replacedBy, row.usedAt, now);
        if (!retry) {
          await this.revokeFamily(tx, row.familyId, now);
          await tx
            .insert(securityEvents)
            .values({ userId, type: 'refresh_reuse', deviceId: row.deviceId });
          return { kind: 'reused', deviceId: row.deviceId } as const;
        }
      }
      const next = await this.insertRefresh(tx, userId, row.deviceId, row.familyId);
      await tx
        .update(refreshTokens)
        .set({ usedAt: row.usedAt ?? now, replacedBy: next.id })
        .where(eq(refreshTokens.id, row.id));
      await tx.update(devices).set({ lastSeenAt: now }).where(eq(devices.id, row.deviceId));
      return { kind: 'ok', next, deviceId: row.deviceId, familyId: row.familyId } as const;
    });

    // Revocation must be committed before answering, so it is reported after the transaction.
    if (outcome.kind === 'reused') {
      // The device's live connection ends too, and its circles move to new keys.
      await this.lifecycle.notify({
        userId,
        kind: 'revoked',
        deviceId: outcome.deviceId,
        newDevice: false,
        replacedDeviceId: null,
      });
    }
    if (outcome.kind !== 'ok') throw new ApiError(HttpStatus.UNAUTHORIZED, 'REFRESH_INVALID');
    return this.complete({
      userId,
      deviceId: outcome.deviceId,
      familyId: outcome.familyId,
      refreshToken: outcome.next.token,
      refreshTokenExpiresAt: outcome.next.expiresAt.getTime(),
      isNewUser: false,
    });
  }

  /** Ends the session and retires the device; the app wipes its keys. */
  async logout(auth: AuthContext): Promise<void> {
    const now = new Date();
    await this.database.asUser(auth.userId, async (tx) => {
      await this.revokeFamily(tx, auth.sessionId, now);
      await tx
        .update(devices)
        .set({ revokedAt: now, revokedReason: 'logout' })
        .where(and(eq(devices.id, auth.deviceId), isNull(devices.revokedAt)));
      await tx
        .insert(securityEvents)
        .values({ userId: auth.userId, type: 'logout', deviceId: auth.deviceId });
    });
  }

  private async retrySuccessor(
    tx: Tx,
    successorId: string | null,
    usedAt: Date,
    now: Date,
  ): Promise<boolean> {
    if (successorId === null || now.getTime() - usedAt.getTime() > REFRESH_RETRY_GRACE_MS) {
      return false;
    }
    const [successor] = await tx
      .select({ usedAt: refreshTokens.usedAt, revokedAt: refreshTokens.revokedAt })
      .from(refreshTokens)
      .where(eq(refreshTokens.id, successorId))
      .for('update');
    if (successor?.usedAt !== null || successor.revokedAt !== null) {
      return false;
    }
    // The client never received the successor; retire it and continue from the retried token.
    await tx.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, successorId));
    return true;
  }

  private async revokeFamily(tx: Tx, familyId: string, now: Date): Promise<void> {
    await tx
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  private async insertRefresh(
    tx: Tx,
    userId: string,
    deviceId: string,
    familyId: string,
  ): Promise<IssuedRefresh> {
    const id = randomUuid();
    const token = `rt1.${userId}.${id}.${generateToken()}`;
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await tx
      .insert(refreshTokens)
      .values({ id, userId, deviceId, familyId, tokenHash: hashToken(token), expiresAt });
    return { id, token, expiresAt };
  }
}
