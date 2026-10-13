import { HttpStatus, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '@bargu/crypto';
import { AVATAR_EMOJIS, type Invite, type InviteCreate, type InvitePreview } from '@bargu/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { invites } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { CirclesService } from './circles.service.js';

/** Invite links live a day and work once (BARGU_PLAN Faz 4: single use, time-limited). */
export const INVITE_TTL_MS = 24 * 3600 * 1000;
export const INVITE_LIMITS = { createdPerHour: 30, previewsPerHour: 120 } as const;
/** What the QR code and shared link carry; opens the app (universal links come with the domain). */
export const inviteLink = (token: string) => `bargu://i/${token}`;

const HOUR = 3600;
const emojis: ReadonlySet<string> = new Set(AVATAR_EMOJIS);

interface PreviewRow extends Record<string, unknown> {
  kind: 'circle' | 'friend';
  inviter_username: string | null;
  inviter_display_name: string | null;
  inviter_avatar_color: number | null;
  inviter_avatar_emoji: string | null;
  circle_name: string | null;
  circle_kind: 'pair' | 'friends' | 'family' | 'event' | null;
  member_count: number | null;
}

/**
 * Invite links and QR codes. The token (256 bits) exists only in the link; the database keeps its
 * hash. Redeeming is one atomic statement (app.redeem_invite), so a single-use link works exactly
 * once even under concurrent attempts.
 */
@Injectable()
export class InvitesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly circles: CirclesService,
    private readonly limiter: RateLimiter,
  ) {}

  async create(auth: AuthContext, input: InviteCreate): Promise<Invite> {
    await this.limit(`invite-create:${auth.userId}`, INVITE_LIMITS.createdPerHour);
    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const id = await this.database.asUser(auth.userId, async (tx) => {
      if (input.kind === 'circle') {
        const circle = await this.circles.read(tx, input.circleId, auth.userId);
        if (circle?.myStatus !== 'active' || circle.kind === 'pair') {
          throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
        }
      }
      const [row] = await tx
        .insert(invites)
        .values({
          kind: input.kind,
          circleId: input.kind === 'circle' ? input.circleId : null,
          tokenHash: hashToken(token),
          createdBy: auth.userId,
          expiresAt,
        })
        .returning({ id: invites.id });
      if (row === undefined) throw new Error('invite insert returned nothing');
      return row.id;
    });
    return { id, token, link: inviteLink(token), expiresAt: expiresAt.getTime() };
  }

  /** What the person holding the link is about to join; same 404 for every unusable token. */
  async preview(auth: AuthContext, token: string): Promise<InvitePreview> {
    await this.limit(`invite-preview:${auth.userId}`, INVITE_LIMITS.previewsPerHour);
    const row = await this.database.asUser(auth.userId, async (tx) => {
      const result = await tx.execute<PreviewRow>(
        sql`SELECT * FROM app.invite_preview(${hashToken(token)})`,
      );
      return result.rows[0];
    });
    if (row?.inviter_username === null || row === undefined) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
    }
    return {
      kind: row.kind,
      inviter: {
        username: row.inviter_username,
        displayName: row.inviter_display_name,
        avatar:
          row.inviter_avatar_color === null
            ? null
            : {
                color: row.inviter_avatar_color,
                emoji:
                  row.inviter_avatar_emoji !== null && emojis.has(row.inviter_avatar_emoji)
                    ? row.inviter_avatar_emoji
                    : null,
              },
      },
      circle:
        row.circle_kind === null
          ? null
          : { name: row.circle_name, kind: row.circle_kind, memberCount: row.member_count ?? 0 },
    };
  }

  /** Joins through the link; the circle starts a new epoch for its new member. */
  async accept(auth: AuthContext, token: string): Promise<{ circleId: string }> {
    await this.limit(`invite-preview:${auth.userId}`, INVITE_LIMITS.previewsPerHour);
    const circleId = await this.database
      .asUser(auth.userId, async (tx) => {
        const result = await tx.execute<{ id: string | null }>(
          sql`SELECT app.redeem_invite(${hashToken(token)}) AS id`,
        );
        const id = result.rows[0]?.id ?? null;
        if (id === null) throw new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
        await this.circles.startEpoch(tx, id);
        return id;
      })
      .catch((error: unknown) => {
        throw refusal(error);
      });
    await this.circles.announce(auth.userId, circleId);
    return { circleId };
  }

  async revoke(auth: AuthContext, inviteId: string): Promise<void> {
    await this.database.asUser(auth.userId, async (tx) => {
      const revoked = await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.id, inviteId), isNull(invites.revokedAt)))
        .returning({ id: invites.id });
      if (revoked.length === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    });
  }

  private async limit(key: string, budget: number): Promise<void> {
    const result = await this.limiter.hit(key, budget, HOUR);
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }
}

/** Maps the checks raised inside app.redeem_invite to API answers. */
function refusal(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  const message = [error, error instanceof Error ? error.cause : undefined]
    .map((value) => (value instanceof Error ? value.message : ''))
    .join(' ');
  if (message.includes('circle is full')) return new ApiError(HttpStatus.CONFLICT, 'CIRCLE_FULL');
  if (message.includes('already a member or removed')) {
    return new ApiError(HttpStatus.CONFLICT, 'ALREADY_MEMBER');
  }
  if (message.includes('inviter left') || message.includes('predates the end')) {
    return new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
  }
  return error;
}
