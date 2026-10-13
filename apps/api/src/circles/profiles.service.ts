import { HttpStatus, Injectable } from '@nestjs/common';
import { AVATAR_EMOJIS, normalizeUsername, type PublicProfile } from '@bargu/schemas';
import { sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

/** Looking people up by username before adding them: allowed, but not in bulk. */
export const PROFILE_LOOKUPS_PER_HOUR = 120;

const emojis: ReadonlySet<string> = new Set(AVATAR_EMOJIS);

interface ProfileRow extends Record<string, unknown> {
  username: string;
  display_name: string | null;
  avatar_color: number | null;
  avatar_emoji: string | null;
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Name and avatar of a username; 404 when nobody has it (the same as the name check says). */
  async byUsername(auth: AuthContext, input: string): Promise<PublicProfile> {
    const result = await this.limiter.hit(
      `profile-lookup:${auth.userId}`,
      PROFILE_LOOKUPS_PER_HOUR,
      3600,
    );
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
    const username = normalizeUsername(input);
    const row = await this.database.asUser(auth.userId, async (tx) => {
      const found = await tx.execute<ProfileRow>(
        sql`SELECT * FROM app.public_profile(${username})`,
      );
      return found.rows[0];
    });
    if (row === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return {
      username: row.username,
      displayName: row.display_name,
      avatar:
        row.avatar_color === null
          ? null
          : {
              color: row.avatar_color,
              emoji:
                row.avatar_emoji !== null && emojis.has(row.avatar_emoji) ? row.avatar_emoji : null,
            },
    };
  }
}
