import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/** Who a request acts for, established by AuthGuard from the access token and the database. */
export interface AuthContext {
  userId: string;
  deviceId: string;
  sessionId: string;
  identityKey: Uint8Array;
}

export type AuthedRequest = FastifyRequest & { auth?: AuthContext; rawBody?: Buffer };

export const IS_PUBLIC = 'bargu:public';
export const SIGNATURE_POLICY = 'bargu:signature';

/** No access token needed (login, health, well-known files). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Exempts a mutating route from the device signature. Only for requests that cannot be signed yet
 * because no device key exists or is known (asking for a login code or a challenge).
 */
export const Unsigned = () => SetMetadata(SIGNATURE_POLICY, 'none');

/** The handler verifies the signature itself, after resolving the key (login, token refresh). */
export const SignedInHandler = () => SetMetadata(SIGNATURE_POLICY, 'handler');

export const CurrentAuth = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthContext => {
    const { auth } = ctx.switchToHttp().getRequest<AuthedRequest>();
    if (auth) return auth;
    // AuthGuard runs before every non-public route; reaching here without it is a wiring bug.
    throw new Error('CurrentAuth used on a public route');
  },
);
