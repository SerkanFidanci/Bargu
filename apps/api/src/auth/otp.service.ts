import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  bytesEqual,
  emailLookupKey,
  fromBase64url,
  pseudonym,
  randomUuid,
  toBase64url,
  verifyOtpCode,
} from '@bargu/crypto';
import type { OtpChallenge, OtpRequest } from '@bargu/schemas';

import { ApiError } from '../common/api-error.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { EmailJobs } from '../jobs/email-jobs.js';
import { AuthKeys } from './auth-keys.js';
import { ClientLimits, DAY, HOUR } from './client-limits.js';

export const OTP_TTL_SECONDS = 10 * 60;
/** BARGU_PLAN §3.2: a challenge dies after 5 wrong codes. */
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_LIMITS = {
  /** Codes one device may request for one address per hour. */
  requestsPerDevice: 3,
  /** Codes sent to one address per day, whoever asks (no mail bombing through us). */
  requestsPerAddress: 20,
  /** Wrong codes per (address, device) per hour; only that device is locked out. */
  failuresPerDevice: 10,
  /**
   * Wrong codes per address per day across all devices; then the address is locked for everyone.
   * With 8-digit codes this caps an attacker at 50 guesses a day (NIST SP 800-63B allows 100).
   */
  failuresPerAddress: 50,
} as const;

// Counts the attempt and returns the challenge in one atomic step; a missing (expired or used)
// challenge is never recreated without a TTL.
const ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
return { attempts, redis.call('HGET', KEYS[1], 'e'), redis.call('HGET', KEYS[1], 'k') }
`;

// Reserves one failure slot in both budgets before the code is compared, so concurrent guesses
// can never exceed them; a correct code gives its slot back. Returns both counts.
const RESERVE = `
local counts = {}
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[i]) end
  counts[i] = count
end
return counts
`;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');

/**
 * Email one-time codes (BARGU_PLAN §3.2, docs/ADR/0005): 8 digits, 10 minutes, 5 attempts per
 * challenge. A challenge belongs to the device key that requested it, and wrong codes are counted
 * per (address, device) plus a daily cap per address: a stranger cannot spend a user's attempts,
 * and nobody gets more than a few dozen guesses a day. The code is derived from the challenge id
 * with a server key, so it is stored nowhere, not even hashed.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger('Otp');

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly limiter: RateLimiter,
    private readonly clients: ClientLimits,
    private readonly keys: AuthKeys,
    private readonly email: EmailJobs,
  ) {}

  /** The same answer whether or not an account exists: nothing to enumerate. */
  async request({ email, locale, identityKey }: OtpRequest, ip: string): Promise<OtpChallenge> {
    await this.clients.enforce('otpRequest', ip);
    try {
      fromBase64url(identityKey, 32); // canonical encoding only: one key, one budget
    } catch {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    const address = this.address(email);
    const device = this.devicePseudonym(identityKey);
    await this.assertNotLocked(address, device);
    for (const [key, limit, window] of [
      [`otp-req-d:${address}:${device}`, OTP_LIMITS.requestsPerDevice, HOUR],
      [`otp-req-a:${address}`, OTP_LIMITS.requestsPerAddress, DAY],
    ] as const) {
      const result = await this.limiter.hit(key, limit, window);
      if (!result.allowed) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
      }
    }

    const challengeId = randomUuid();
    const key = `otp:${challengeId}`;
    await this.redis
      .multi()
      .hSet(key, { e: address, k: identityKey, a: '0' })
      .expire(key, OTP_TTL_SECONDS)
      .exec();
    try {
      await this.email.enqueueOtp({ to: email, locale, challengeId });
    } catch (error) {
      await this.redis.del(key);
      this.logger.error(
        `Could not queue the email: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'UNAVAILABLE');
    }
    return { challengeId, expiresIn: OTP_TTL_SECONDS };
  }

  /** Called first in the login handler, before any expensive device or attestation check. */
  limitVerification(ip: string): Promise<void> {
    return this.clients.enforce('otpVerify', ip);
  }

  /**
   * Checks a code presented by the device holding `identityKey` and consumes the challenge.
   * Returns the email HMAC of the address the code was sent to.
   */
  async verify(challengeId: string, code: string, identityKey: Uint8Array): Promise<Uint8Array> {
    const key = `otp:${challengeId}`;
    const state = (await this.redis.eval(ATTEMPT, { keys: [key] })) as
      [number, string, string] | null;
    if (state === null) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    const [attempts, address, boundKey] = state;
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }

    const budgets = [
      `rl:otp-fail-d:${address}:${this.devicePseudonym(toBase64url(identityKey))}`,
      `rl:otp-fail-a:${address}`,
    ];
    const [perDevice = 0, perAddress = 0] = (await this.redis.eval(RESERVE, {
      keys: budgets,
      arguments: [String(HOUR), String(DAY)],
    })) as number[];
    if (perDevice > OTP_LIMITS.failuresPerDevice || perAddress > OTP_LIMITS.failuresPerAddress) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }

    const correct =
      bytesEqual(fromBase64url(boundKey, 32), identityKey) &&
      verifyOtpCode(this.keys.otpKey, challengeId, code);
    if (!correct) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID');

    // Single use: of two concurrent correct submissions only the one that deletes it wins.
    if ((await this.redis.del(key)) !== 1) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    }
    // A correct code is not a failure: give the reserved slots back.
    await Promise.all(budgets.map((budget) => this.redis.decr(budget)));
    return new Uint8Array(Buffer.from(address, 'hex'));
  }

  private address(email: string): string {
    return hex(emailLookupKey(this.keys.emailLookupKey, email));
  }

  private devicePseudonym(identityKey: string): string {
    return pseudonym(this.keys.emailLookupKey, 'device', identityKey);
  }

  private async assertNotLocked(address: string, device: string): Promise<void> {
    const [perDevice, perAddress] = await Promise.all([
      this.limiter.peek(`otp-fail-d:${address}:${device}`),
      this.limiter.peek(`otp-fail-a:${address}`),
    ]);
    if (perDevice >= OTP_LIMITS.failuresPerDevice || perAddress >= OTP_LIMITS.failuresPerAddress) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }
  }
}
