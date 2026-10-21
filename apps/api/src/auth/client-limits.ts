import { HttpStatus, Injectable } from '@nestjs/common';
import { pseudonym } from '@bargu/crypto';

import { ApiError } from '../common/api-error.js';
import { clientBucket } from '../common/client-ip.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { AuthKeys } from './auth-keys.js';

export const HOUR = 3600;
export const DAY = 24 * HOUR;

/** Per-client budgets of the endpoints that work before any login (per IPv4 or IPv6 /64). */
export const CLIENT_LIMITS = {
  otpRequest: 20,
  otpVerify: 60,
  attestationChallenge: 30,
  passkeyOptions: 30,
  passkeyVerify: 30,
  // The account web page (docs/ADR/0021).
  webCode: 10,
  webVerify: 30,
  webRevoke: 10,
  webDelete: 10,
  webUnlock: 10,
  // The invite page (docs/ADR/0009 Ek, 2026-10-22). Generous, because link previews are fetched by
  // the messaging apps' servers: many people's previews come from a handful of addresses.
  invitePage: 300,
} as const;

/**
 * Rate limits keyed by client network. The key is a keyed pseudonym of the IPv4 address or IPv6
 * /64, never the address itself, and expires with its window.
 */
@Injectable()
export class ClientLimits {
  constructor(
    private readonly limiter: RateLimiter,
    private readonly keys: AuthKeys,
  ) {}

  clientId(ip: string): string {
    return pseudonym(this.keys.emailLookupKey, 'client', clientBucket(ip));
  }

  /**
   * The same for budgets that must not multiply with the addresses one owns: IPv6 counts by /48
   * (QA 4 K2a). Used for what the account web page allows one address.
   */
  networkId(ip: string): string {
    return pseudonym(this.keys.emailLookupKey, 'client', clientBucket(ip, 48));
  }

  async enforce(endpoint: keyof typeof CLIENT_LIMITS, ip: string): Promise<void> {
    const result = await this.limiter.hit(
      `${endpoint}:${this.clientId(ip)}`,
      CLIENT_LIMITS[endpoint],
      HOUR,
    );
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }
}
