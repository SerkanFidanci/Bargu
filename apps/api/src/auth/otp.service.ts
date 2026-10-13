import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { emailLookupKey, hashToken, randomUuid, verifyOtpCode } from '@bargu/crypto';
import type { OtpChallenge, OtpRequest } from '@bargu/schemas';

import { ApiError } from '../common/api-error.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { EmailJobs } from '../jobs/email-jobs.js';
import { AuthKeys } from './auth-keys.js';

export const OTP_TTL_SECONDS = 10 * 60;
/** BARGU_PLAN §3.2: a challenge dies after 5 wrong codes. */
export const OTP_MAX_ATTEMPTS = 5;
const HOUR = 3600;
export const OTP_LIMITS = {
  requestsPerEmail: 5,
  requestsPerIp: 20,
  /** Wrong codes per address across challenges before the address is locked for an hour. */
  failuresPerEmail: 10,
  verificationsPerIp: 60,
} as const;

// Counts the attempt and returns the challenge in one atomic step; a missing (expired or used)
// challenge is never recreated without a TTL.
const ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
return { attempts, redis.call('HGET', KEYS[1], 'e') }
`;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
/** Rate-limit keys never hold an IP in clear (hashed, and the counters expire within the hour). */
export const ipKey = (ip: string) => hex(hashToken(`ip:${ip}`)).slice(0, 32);

/**
 * Email one-time codes (BARGU_PLAN §3.2): 6 digits, 10 minutes, 5 attempts per challenge, address
 * and IP rate limits. The challenge lives only in Redis with its TTL; the code is derived from the
 * challenge id with a server key, so it is stored nowhere, not even hashed.
 */
@Injectable()
export class OtpService {
  private readonly logger = new Logger('Otp');

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly limiter: RateLimiter,
    private readonly keys: AuthKeys,
    private readonly email: EmailJobs,
  ) {}

  /** The same answer whether or not an account exists: nothing to enumerate. */
  async request({ email, locale }: OtpRequest, ip: string): Promise<OtpChallenge> {
    const address = hex(emailLookupKey(this.keys.emailLookupKey, email));
    await this.assertNotLocked(address);
    for (const [key, limit] of [
      [`otp-req:e:${address}`, OTP_LIMITS.requestsPerEmail],
      [`otp-req:ip:${ipKey(ip)}`, OTP_LIMITS.requestsPerIp],
    ] as const) {
      const result = await this.limiter.hit(key, limit, HOUR);
      if (!result.allowed) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
      }
    }

    const challengeId = randomUuid();
    const key = `otp:${challengeId}`;
    await this.redis.multi().hSet(key, { e: address, a: '0' }).expire(key, OTP_TTL_SECONDS).exec();
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

  /**
   * Checks a code and consumes the challenge. Returns the email HMAC of the address the code was
   * sent to; the caller resolves or creates the account from it.
   */
  async verify(challengeId: string, code: string, ip: string): Promise<Uint8Array> {
    const perIp = await this.limiter.hit(
      `otp-ver:ip:${ipKey(ip)}`,
      OTP_LIMITS.verificationsPerIp,
      HOUR,
    );
    if (!perIp.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', perIp.retryAfter);
    }

    const key = `otp:${challengeId}`;
    const state = (await this.redis.eval(ATTEMPT, { keys: [key] })) as [number, string] | null;
    if (state === null) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    const [attempts, address] = state;
    if (attempts > OTP_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }
    await this.assertNotLocked(address);

    if (!verifyOtpCode(this.keys.otpKey, challengeId, code)) {
      await this.limiter.hit(`otp-fail:${address}`, OTP_LIMITS.failuresPerEmail, HOUR);
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID');
    }
    // Single use: of two concurrent correct submissions only the one that deletes it wins.
    if ((await this.redis.del(key)) !== 1)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    return new Uint8Array(Buffer.from(address, 'hex'));
  }

  private async assertNotLocked(address: string): Promise<void> {
    if ((await this.limiter.peek(`otp-fail:${address}`)) >= OTP_LIMITS.failuresPerEmail) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }
  }
}
