import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  bytesEqual,
  emailLookupKey,
  generateToken,
  hashToken,
  randomUuid,
  sha256,
  verifyWebCode,
} from '@bargu/crypto';
import type {
  WebChallenge,
  WebCodeRequest,
  WebCodeVerify,
  WebRevoke,
  WebSession,
} from '@bargu/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { devices, pushTokens, refreshTokens, securityEvents } from '../db/schema.js';
import { DeviceLifecycle } from '../devices/device-lifecycle.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { EmailJobs } from '../jobs/email-jobs.js';
import { AuthKeys } from './auth-keys.js';
import { ClientLimits, DAY, HOUR } from './client-limits.js';

export const WEB_CODE_TTL_SECONDS = 10 * 60;
export const WEB_SESSION_TTL_SECONDS = 10 * 60;
/** A challenge dies after this many wrong codes. */
export const WEB_MAX_ATTEMPTS = 3;
export const WEB_LIMITS = {
  /** Codes sent to one address: no mail bombing through this page. */
  requestsPerHour: 3,
  requestsPerDay: 5,
  /**
   * Wrong codes per address a day. With 8-digit codes (10^8) that is a 5·10^-8 chance a day for
   * someone guessing; the login code's budgets are not touched (docs/ADR/0021).
   */
  failuresPerDay: 5,
} as const;

// Counts the attempt and returns the challenge in one atomic step (see otp.service).
const ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
return { attempts, redis.call('HGET', KEYS[1], 'u'), redis.call('HGET', KEYS[1], 'e'),
  redis.call('HGET', KEYS[1], 'b') }
`;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
const bindingHash = (binding: string) => hex(sha256(new TextEncoder().encode(binding)));

/**
 * The account web page (docs/ADR/0021): someone without their phone takes it off their account
 * with an 8-digit code from their email. The code works only with the page that asked for it
 * (its random binding), three tries a code, five wrong a day per address, a few codes a day per
 * address, and per network. Every address gets the same answers, account or not; only an account
 * gets an email. The session that follows lives ten minutes and does one thing.
 */
@Injectable()
export class WebAccountService {
  private readonly logger = new Logger('WebAccount');

  constructor(
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly limiter: RateLimiter,
    private readonly clients: ClientLimits,
    private readonly keys: AuthKeys,
    private readonly email: EmailJobs,
    private readonly database: DatabaseService,
    private readonly lifecycle: DeviceLifecycle,
  ) {}

  async requestCode(input: WebCodeRequest, ip: string): Promise<WebChallenge> {
    await this.clients.enforce('webCode', ip);
    const lookup = emailLookupKey(this.keys.emailLookupKey, input.email);
    const address = hex(lookup);
    for (const [key, limit, window] of [
      [`web-req-h:${address}`, WEB_LIMITS.requestsPerHour, HOUR],
      [`web-req-d:${address}`, WEB_LIMITS.requestsPerDay, DAY],
    ] as const) {
      const result = await this.limiter.hit(key, limit, window);
      if (!result.allowed) {
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
      }
    }
    const userId = await this.database.userIdForEmail(lookup);
    const challengeId = randomUuid();
    const key = `web:${challengeId}`;
    // Kept for an unknown address too (no email goes out): checking a code answers the same.
    await this.redis
      .multi()
      .hSet(key, { u: userId ?? '', e: address, b: bindingHash(input.binding), a: '0' })
      .expire(key, WEB_CODE_TTL_SECONDS)
      .exec();
    if (userId !== null) {
      try {
        await this.email.enqueueWebCode({ to: input.email, locale: input.locale, challengeId });
      } catch (error) {
        await this.redis.del(key);
        this.logger.error(
          `Could not queue the email: ${error instanceof Error ? error.name : 'unknown'}`,
        );
        throw new ApiError(HttpStatus.SERVICE_UNAVAILABLE, 'UNAVAILABLE');
      }
    }
    return { challengeId, expiresIn: WEB_CODE_TTL_SECONDS };
  }

  async verify(input: WebCodeVerify, ip: string): Promise<WebSession> {
    await this.clients.enforce('webVerify', ip);
    const key = `web:${input.challengeId}`;
    const state = (await this.redis.eval(ATTEMPT, { keys: [key] })) as
      [number, string, string, string] | null;
    if (state === null) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    const [attempts, userId, address, boundTo] = state;
    if (attempts > WEB_MAX_ATTEMPTS) {
      await this.redis.del(key);
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }
    // One failure slot is taken before comparing; a correct code gives it back.
    const budget = `rl:web-fail:${address}`;
    const failures = await this.redis.incr(budget);
    if (failures === 1) await this.redis.expire(budget, DAY);
    if (failures > WEB_LIMITS.failuresPerDay) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LOCKED');
    }
    const correct =
      userId !== '' &&
      bytesEqual(
        new Uint8Array(Buffer.from(boundTo, 'hex')),
        new Uint8Array(Buffer.from(bindingHash(input.binding), 'hex')),
      ) &&
      verifyWebCode(this.keys.otpKey, input.challengeId, input.code);
    if (!correct) throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID');
    // Single use: of two concurrent correct submissions only the one that deletes it wins.
    if ((await this.redis.del(key)) !== 1) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    }
    await this.redis.decr(budget);

    const token = generateToken();
    await this.redis.set(`web-session:${hex(hashToken(token))}`, userId, {
      EX: WEB_SESSION_TTL_SECONDS,
    });
    const [device] = await this.database.asUser(userId, (tx) =>
      tx
        .select({ platform: devices.platform, createdAt: devices.createdAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt))),
    );
    return {
      token,
      expiresIn: WEB_SESSION_TTL_SECONDS,
      device:
        device === undefined
          ? null
          : { platform: device.platform, since: device.createdAt.getTime() },
    };
  }

  /**
   * "Telefonumu hesaptan çıkar": the phone signed in now is revoked like a stolen one. Its session
   * and refresh tokens end, it gets no more notifications, every circle moves to a new epoch and
   * its dot leaves the maps; it wipes itself the next time it reaches the server. The session of
   * the page is used up.
   */
  async revokeDevice(input: WebRevoke, ip: string): Promise<{ revoked: boolean }> {
    await this.clients.enforce('webRevoke', ip);
    const userId = await this.redis.getDel(`web-session:${hex(hashToken(input.token))}`);
    if (userId === null) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    const deviceId = await this.database.asUser(userId, async (tx) => {
      const [active] = await tx
        .select({ id: devices.id })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .for('update');
      if (active === undefined) return null;
      const now = new Date();
      await tx
        .update(devices)
        .set({ revokedAt: now, revokedReason: 'remote' })
        .where(eq(devices.id, active.id));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.deviceId, active.id), isNull(refreshTokens.revokedAt)));
      await tx.delete(pushTokens).where(eq(pushTokens.deviceId, active.id));
      await tx
        .insert(securityEvents)
        .values({ userId, type: 'device_revoked_remote', deviceId: active.id });
      return active.id;
    });
    if (deviceId === null) return { revoked: false };
    await this.lifecycle.notify({
      userId,
      kind: 'revoked',
      deviceId,
      newDevice: false,
      replacedDeviceId: null,
    });
    return { revoked: true };
  }
}
