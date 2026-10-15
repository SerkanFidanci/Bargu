import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  bytesEqual,
  emailLookupKey,
  generateToken,
  hashToken,
  randomUuid,
  sha256,
  verifyWebCode,
  verifyWebUnlockToken,
} from '@bargu/crypto';
import type {
  WebChallenge,
  WebCodeRequest,
  WebCodeVerify,
  WebRevoke,
  WebSession,
  WebUnlock,
  WebUnlocked,
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
import { ClientLimits, DAY } from './client-limits.js';

export const WEB_CODE_TTL_SECONDS = 10 * 60;
export const WEB_SESSION_TTL_SECONDS = 10 * 60;
/** How long a browser that came in with a code is remembered, and how many per account. */
export const WEB_REMEMBER_TTL_SECONDS = 180 * 24 * 3600;
const WEB_REMEMBERED_MAX = 5;
/** How long the emailed "recognise this browser" link works (QA 4 K2b); at most one a day. */
export const WEB_UNLOCK_TTL_SECONDS = DAY;
/** A challenge dies after this many wrong codes. */
export const WEB_MAX_ATTEMPTS = 3;
/**
 * Budgets per address AND network (the client's IPv4 or IPv6 /48, as a keyed pseudonym), so that
 * someone who knows only the address cannot use up its owner's codes or tries from elsewhere (a
 * thief blocking the owner, QA 3b N1); per address alone only far higher ceilings, against mail
 * bombing and guessing from many networks. At most 150 wrong codes a day out of 10^8: a 1.5·10^-6
 * chance a day. Using up the address's ceilings takes 17 networks a day, and even then a browser
 * that came in with a code before is not held back by them (QA 4 K2). The login code's budgets
 * are not touched (docs/ADR/0021).
 */
export const WEB_LIMITS = {
  requestsPerNetworkDay: 3,
  requestsPerAddressDay: 50,
  failuresPerNetworkDay: 10,
  failuresPerAddressDay: 150,
} as const;

// Reserves one failure slot in each budget before the code is compared (see otp.service), so
// concurrent guesses can never exceed them; a correct code gives its slots back.
const RESERVE = `
local counts = {}
for i, key in ipairs(KEYS) do
  local count = redis.call('INCR', key)
  if count == 1 then redis.call('EXPIRE', key, ARGV[i]) end
  counts[i] = count
end
return counts
`;

// Counts the attempt and returns the challenge in one atomic step (see otp.service).
const ATTEMPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return false end
local attempts = redis.call('HINCRBY', KEYS[1], 'a', 1)
return { attempts, redis.call('HGET', KEYS[1], 'u'), redis.call('HGET', KEYS[1], 'e'),
  redis.call('HGET', KEYS[1], 'b') }
`;

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString('hex');
/** The set naming an account's pending web codes and sessions (see WebAccountService.index). */
export const webKeysOf = (userId: string) => `web-of:${userId}`;
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
    const network = this.clients.networkId(ip);
    const userId = await this.database.userIdForEmail(lookup);
    const known = await this.isRemembered(userId, input.remember);
    // Read for every address alike, so that an account's answer takes as long as a stranger's.
    const failures = Number((await this.redis.get(`rl:web-fail-a:${address}`)) ?? '0');
    const budgets: [string, number][] = [
      [`web-req-nd:${address}:${network}`, WEB_LIMITS.requestsPerNetworkDay],
    ];
    if (!known) budgets.push([`web-req-a:${address}`, WEB_LIMITS.requestsPerAddressDay]);
    for (const [budget, limit] of budgets) {
      const result = await this.limiter.hit(budget, limit, DAY);
      if (!result.allowed) {
        if (budget.startsWith('web-req-a:')) this.offerUnlock(userId, address, input);
        throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
      }
    }
    if (!known && failures >= WEB_LIMITS.failuresPerAddressDay) {
      this.offerUnlock(userId, address, input);
    }
    const challengeId = randomUuid();
    const key = `web:${challengeId}`;
    // Kept for an unknown address too (no email goes out): checking a code answers the same.
    await this.redis
      .multi()
      .hSet(key, { u: userId ?? '', e: address, b: bindingHash(input.binding), a: '0' })
      .expire(key, WEB_CODE_TTL_SECONDS)
      .exec();
    if (userId !== null) await this.index(userId, key);
    if (userId !== null) {
      // Not waited for: an account's answer takes as long as a stranger's (QA 3b N3). Should it
      // fail, no email comes and asking again sends a new code.
      void this.email
        .enqueueWebCode({ to: input.email, locale: input.locale, challengeId })
        .catch((error: unknown) => {
          this.logger.error(
            `Could not queue the email: ${error instanceof Error ? error.name : 'unknown'}`,
          );
        });
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
    const known = await this.isRemembered(userId === '' ? null : userId, input.remember);
    const budgets = [`rl:web-fail-n:${address}:${this.clients.networkId(ip)}`];
    if (!known) budgets.push(`rl:web-fail-a:${address}`);
    const [perNetwork = 0, perAddress = 0] = (await this.redis.eval(RESERVE, {
      keys: budgets,
      arguments: budgets.map(() => String(DAY)),
    })) as number[];
    if (
      perNetwork > WEB_LIMITS.failuresPerNetworkDay ||
      perAddress > WEB_LIMITS.failuresPerAddressDay
    ) {
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
    await Promise.all(budgets.map((budget) => this.redis.decr(budget)));

    const token = generateToken();
    const session = `web-session:${hex(hashToken(token))}`;
    await this.redis.set(session, userId, { EX: WEB_SESSION_TTL_SECONDS });
    await this.index(userId, session);
    const remember = await this.rememberBrowser(userId);
    const [device] = await this.database.asUser(userId, (tx) =>
      tx
        .select({ platform: devices.platform, createdAt: devices.createdAt })
        .from(devices)
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt))),
    );
    return {
      token,
      expiresIn: WEB_SESSION_TTL_SECONDS,
      remember,
      device:
        device === undefined
          ? null
          : { platform: device.platform, since: device.createdAt.getTime() },
    };
  }

  /**
   * The address's ceilings are full and this browser is not known: its owner may be the one locked
   * out by someone else filling them (QA 4 K2b). An account gets an email with a link, at most once
   * a day, that makes the browser it is opened in a known one: no access by itself, the code still
   * comes by email. Not waited for, and nothing for an address without an account.
   */
  private offerUnlock(
    userId: string | null,
    address: string,
    to: Pick<WebCodeRequest, 'email' | 'locale'>,
  ): void {
    if (userId === null) return;
    void this.sendUnlock(userId, address, to).catch((error: unknown) => {
      this.logger.error(
        `Could not offer the unlock: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    });
  }

  private async sendUnlock(
    userId: string,
    address: string,
    to: Pick<WebCodeRequest, 'email' | 'locale'>,
  ): Promise<void> {
    // Once a day an address: whoever fills its ceilings can make it come once, no more.
    const sent = `web-unlock-sent:${address}`;
    const first = await this.redis.set(sent, '1', {
      condition: 'NX',
      expiration: { type: 'EX', value: DAY },
    });
    if (first !== 'OK') return;
    const unlockId = randomUuid();
    const key = `web-unlock:${unlockId}`;
    try {
      await this.redis.set(key, userId, { EX: WEB_UNLOCK_TTL_SECONDS });
      await this.index(userId, key, WEB_UNLOCK_TTL_SECONDS);
      await this.email.enqueueWebUnlock({ to: to.email, locale: to.locale, challengeId: unlockId });
    } catch (error) {
      // Not queued: the day's one email has not gone, so the next request may try again (QA 6b
      // K2b-1). The link without its email opens nothing anyone has.
      await this.redis.del([sent, key]);
      throw error;
    }
  }

  /**
   * The emailed link opened (QA 4 K2b): the browser it was opened in is remembered like one that
   * came in with a code. Works once.
   */
  async unlock(input: WebUnlock, ip: string): Promise<WebUnlocked> {
    await this.clients.enforce('webUnlock', ip);
    if (!verifyWebUnlockToken(this.keys.otpKey, input.id, input.token)) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID');
    }
    const userId = await this.redis.getDel(`web-unlock:${input.id}`);
    if (userId === null || userId === '') {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'OTP_EXPIRED');
    }
    return { remember: await this.rememberBrowser(userId) };
  }

  /** A new value for this browser to keep; the account's newest five count, each 180 days. */
  private async rememberBrowser(userId: string): Promise<string> {
    const remember = generateToken();
    const remembered = `web-known:${userId}`;
    await this.redis
      .multi()
      // Each value counts its own 180 days (QA 4 K2c): older ones go before a new one comes.
      .zRemRangeByScore(remembered, 0, Date.now() - WEB_REMEMBER_TTL_SECONDS * 1000)
      .zAdd(remembered, { score: Date.now(), value: hex(hashToken(remember)) })
      .zRemRangeByRank(remembered, 0, -(WEB_REMEMBERED_MAX + 1))
      .expire(remembered, WEB_REMEMBER_TTL_SECONDS)
      .exec();
    return remember;
  }

  /** Whether this browser came in with a code for the account before (and not too long ago). */
  private async isRemembered(userId: string | null, remember: string | undefined) {
    if (userId === null || remember === undefined) return false;
    const score = await this.redis.zScore(`web-known:${userId}`, hex(hashToken(remember)));
    return score !== null && Date.now() - score <= WEB_REMEMBER_TTL_SECONDS * 1000;
  }

  /**
   * The account's pending codes and sessions, by name: deleting the account deletes them too, though
   * their own names do not say whose they are (QA 4 K1).
   */
  private async index(userId: string, key: string, ttl = WEB_SESSION_TTL_SECONDS): Promise<void> {
    const of = webKeysOf(userId);
    // As long as its longest-lived key: a set, or one with less time left, gets this much.
    await this.redis.multi().sAdd(of, key).expire(of, ttl, 'NX').expire(of, ttl, 'GT').exec();
  }

  /**
   * Uses up the page's session for its one action and says whose account it is (the account
   * module deletes it with this, docs/ADR/0022).
   */
  async takeSession(token: string, ip: string, action: 'webRevoke' | 'webDelete'): Promise<string> {
    await this.clients.enforce(action, ip);
    const userId = await this.redis.getDel(`web-session:${hex(hashToken(token))}`);
    if (userId === null || userId === '') {
      throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    }
    return userId;
  }

  /**
   * "Telefonumu hesaptan çıkar": the phone signed in now is revoked like a stolen one. Its session
   * and refresh tokens end, it gets no more notifications, every circle moves to a new epoch and
   * its dot leaves the maps; it wipes itself the next time it reaches the server. The session of
   * the page is used up.
   */
  async revokeDevice(input: WebRevoke, ip: string): Promise<{ revoked: boolean }> {
    const userId = await this.takeSession(input.token, ip, 'webRevoke');
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
