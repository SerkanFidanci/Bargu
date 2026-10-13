import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { devices, refreshTokens } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { AccessTokens } from './access-tokens.js';
import { RequestSignatures } from './request-signatures.js';
import { type AuthedRequest, IS_PUBLIC, SIGNATURE_POLICY } from './request-context.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global: every route needs a valid access token unless marked @Public. The token alone is not
 * trusted: the device must still be active and the session (refresh family) not revoked, so a
 * logout, device change or reuse detection takes effect on the very next request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: AccessTokens,
    private readonly database: DatabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const match = BEARER.exec(request.headers.authorization ?? '');
    if (match?.[1] === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    const claims = await this.tokens.verify(match[1]);

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

    request.auth = { ...claims, identityKey: device.identityKey };
    return true;
  }
}

/**
 * Global: every state-changing request must be signed by the device's identity key. Public
 * mutating routes must declare how they are signed (@Unsigned or @SignedInHandler); a route that
 * declares nothing is refused, so a forgotten annotation fails closed.
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly signatures: RequestSignatures,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    if (SAFE_METHODS.has(request.method)) return true;
    const policy = this.reflector.getAllAndOverride<'none' | 'handler' | undefined>(
      SIGNATURE_POLICY,
      [context.getHandler(), context.getClass()],
    );
    if (policy !== undefined) return true;
    if (request.auth === undefined)
      throw new Error('mutating public route without a signature policy');
    await this.signatures.verify(request, request.auth.deviceId, request.auth.identityKey);
    return true;
  }
}
