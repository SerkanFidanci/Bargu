import { HttpStatus, Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { devices, refreshTokens } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { AccessTokens } from './access-tokens.js';
import type { AuthContext } from './request-context.js';

/**
 * Turns an access token into who is acting. The token alone is not trusted: the device must still
 * be active and the session (refresh family) not revoked, so a logout, device change or reuse
 * detection takes effect on the very next request (HTTP) or connection (WebSocket).
 */
@Injectable()
export class AuthContexts {
  constructor(
    private readonly tokens: AccessTokens,
    private readonly database: DatabaseService,
  ) {}

  async resolve(accessToken: string): Promise<AuthContext> {
    const claims = await this.tokens.verify(accessToken);
    const device = await this.database.asUser(claims.userId, async (tx) => {
      const [row] = await tx
        .select({ identityKey: devices.identityKey })
        .from(devices)
        .where(and(eq(devices.id, claims.deviceId), isNull(devices.revokedAt)));
      if (row === undefined) return undefined;
      const [session] = await tx
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(and(eq(refreshTokens.familyId, claims.sessionId), isNull(refreshTokens.revokedAt)))
        .limit(1);
      return session === undefined ? undefined : row;
    });
    if (device === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'DEVICE_REVOKED');
    return { ...claims, identityKey: device.identityKey };
  }
}
