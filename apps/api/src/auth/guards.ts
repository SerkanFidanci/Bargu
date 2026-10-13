import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ApiError } from '../common/api-error.js';
import { AuthContexts } from './auth-contexts.js';
import { RequestSignatures } from './request-signatures.js';
import { type AuthedRequest, IS_PUBLIC, SIGNATURE_POLICY } from './request-context.js';

const BEARER = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Global: every route needs a valid access token unless marked @Public, and the device and session
 * behind it must still be live (AuthContexts).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: AuthContexts,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket messages are authenticated once, at the handshake (events.gateway.ts).
    if (context.getType() !== 'http') return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const match = BEARER.exec(request.headers.authorization ?? '');
    if (match?.[1] === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    request.auth = await this.contexts.resolve(match[1]);
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
    if (context.getType() !== 'http') return true;
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
