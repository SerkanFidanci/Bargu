import { HttpStatus, Injectable } from '@nestjs/common';
import {
  isReservedUsername,
  type Me,
  normalizeUsername,
  type ProfileUpdate,
  USERNAME_PATTERN,
  type UsernameAvailability,
} from '@bargu/schemas';
import { count, eq, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { devices, passkeys, users } from '../db/schema.js';
import { isUniqueViolation } from '../devices/device-registry.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

const HOUR = 3600;

/**
 * Per-account budgets. Usernames are meant to be found (that is how friends add each other), but
 * not scraped: a person picking a name checks a few dozen at most.
 */
export const PROFILE_LIMITS = {
  usernameChecksPerHour: 120,
  updatesPerHour: 30,
} as const;

@Injectable()
export class ProfileService {
  constructor(
    private readonly database: DatabaseService,
    private readonly limiter: RateLimiter,
  ) {}

  /** The signed-in account and device. Row-level security scopes every query to the caller. */
  me(auth: AuthContext): Promise<Me> {
    return this.database.asUser(auth.userId, (tx) => this.read(tx, auth));
  }

  async usernameAvailability(auth: AuthContext, input: string): Promise<UsernameAvailability> {
    await this.limit(`username-check:${auth.userId}`, PROFILE_LIMITS.usernameChecksPerHour);
    const username = normalizeUsername(input);
    if (!USERNAME_PATTERN.test(username)) return { username, available: false, reason: 'invalid' };
    if (isReservedUsername(username)) return { username, available: false, reason: 'reserved' };
    const taken = await this.database.asUser(auth.userId, async (tx) => {
      const [own] = await tx.select({ username: users.username }).from(users);
      if (own?.username === username) return false;
      const result = await tx.execute<{ taken: boolean }>(
        sql`SELECT app.username_taken(${username}) AS taken`,
      );
      return result.rows[0]?.taken === true;
    });
    return taken
      ? { username, available: false, reason: 'taken' }
      : { username, available: true, reason: null };
  }

  async update(auth: AuthContext, update: ProfileUpdate): Promise<Me> {
    await this.limit(`profile-update:${auth.userId}`, PROFILE_LIMITS.updatesPerHour);
    try {
      return await this.database.asUser(auth.userId, async (tx) => {
        await tx
          .update(users)
          .set({
            ...(update.username === undefined ? {} : { username: update.username }),
            ...(update.displayName === undefined ? {} : { displayName: update.displayName }),
            ...(update.avatar === undefined
              ? {}
              : { avatarColor: update.avatar.color, avatarEmoji: update.avatar.emoji }),
          })
          .where(eq(users.id, auth.userId));
        return this.read(tx, auth);
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new ApiError(HttpStatus.CONFLICT, 'USERNAME_TAKEN');
      throw error;
    }
  }

  private async limit(key: string, budget: number): Promise<void> {
    const result = await this.limiter.hit(key, budget, HOUR);
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }

  private async read(tx: Tx, auth: AuthContext): Promise<Me> {
    const [user] = await tx
      .select({
        username: users.username,
        displayName: users.displayName,
        avatarColor: users.avatarColor,
        avatarEmoji: users.avatarEmoji,
      })
      .from(users);
    const [device] = await tx
      .select({ platform: devices.platform, attestedAt: devices.attestedAt })
      .from(devices)
      .where(eq(devices.id, auth.deviceId));
    const [keys] = await tx.select({ total: count() }).from(passkeys);
    return {
      userId: auth.userId,
      username: user?.username ?? null,
      displayName: user?.displayName ?? null,
      avatar:
        user?.avatarColor === null || user?.avatarColor === undefined
          ? null
          : { color: user.avatarColor, emoji: user.avatarEmoji },
      device: {
        id: auth.deviceId,
        platform: device?.platform ?? 'android',
        attested: device?.attestedAt !== null && device?.attestedAt !== undefined,
      },
      passkeys: keys?.total ?? 0,
    };
  }
}
