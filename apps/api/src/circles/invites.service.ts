import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '@bargu/crypto';
import { AVATAR_EMOJIS, type Invite, type InviteCreate, type InvitePreview } from '@bargu/schemas';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { guardianRequestsFull } from '../common/guardian-requests.js';
import { ENV } from '../config/config.module.js';
import { type Env, inviteHostOf } from '../config/env.js';
import { invites } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { Notifier } from '../push/notifier.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { CirclesService, othersActive } from './circles.service.js';

/** Invite links live a day and work once (BARGU_PLAN Faz 4: single use, time-limited). */
export const INVITE_TTL_MS = 24 * 3600 * 1000;
/**
 * An event's QR code (BARGU_PLAN Faz 8) lets up to this many people join, until the event ends:
 * one code shown at the event (docs/ADR/0017).
 */
export const EVENT_INVITE_USES = 50;
export const INVITE_LIMITS = { createdPerHour: 30, previewsPerHour: 120 } as const;
/**
 * What the QR code and shared link carry (docs/ADR/0009 Ek 2, 2026-10-22): the invite page's own
 * address with the token in the FRAGMENT, `https://<host>/i#<token>`. A fragment never goes in an
 * HTTP request, so the token stays out of the server's, the proxy's and the link-preview crawlers'
 * logs (a token in the path would reach all of them). A messaging app shows the card of the page,
 * and the app, when it is installed and verified, opens the link (Android App Links).
 */
export const inviteLink = (host: string, token: string) => `https://${host}/i#${token}`;

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
  circle_expires_at: Date | null;
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
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(auth: AuthContext, input: InviteCreate): Promise<Invite> {
    await this.limit(`invite-create:${auth.userId}`, INVITE_LIMITS.createdPerHour);
    const token = generateToken();
    const { id, expiresAt } = await this.database.asUser(auth.userId, async (tx) => {
      let expires = new Date(Date.now() + INVITE_TTL_MS);
      let maxUses = 1;
      if (input.kind === 'circle') {
        const circle = await this.circles.read(tx, input.circleId, auth.userId);
        if (circle?.myStatus !== 'active' || circle.kind === 'pair') {
          throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
        }
        // An event that has ended makes no more codes, even before the sweep (QA Faz 8 D3).
        if (circle.expiresAt !== undefined && circle.expiresAt <= Date.now()) {
          throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
        }
        if (circle.expiresAt !== undefined) {
          // Only an event's admins let people in (docs/ADR/0020; row-level security too).
          if (circle.myRole !== 'owner') throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
          expires = new Date(circle.expiresAt);
          maxUses = EVENT_INVITE_USES;
        }
      }
      const [row] = await tx
        .insert(invites)
        .values({
          kind: input.kind,
          circleId: input.kind === 'circle' ? input.circleId : null,
          tokenHash: hashToken(token),
          createdBy: auth.userId,
          expiresAt: expires,
          maxUses,
        })
        .returning({ id: invites.id });
      if (row === undefined) throw new Error('invite insert returned nothing');
      return { id: row.id, expiresAt: expires };
    });
    return {
      id,
      token,
      link: inviteLink(inviteHostOf(this.env), token),
      expiresAt: expiresAt.getTime(),
    };
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
          : {
              name: row.circle_name,
              kind: row.circle_kind,
              memberCount: row.member_count ?? 0,
              ...(row.circle_expires_at === null
                ? {}
                : { expiresAt: new Date(row.circle_expires_at).getTime() }),
            },
    };
  }

  /**
   * Joins through the link; the circle starts a new epoch for its new member. Asked again by the
   * same person with the same code while they are in (a retried request), it answers the same and
   * changes nothing (QA Faz 9 B2).
   */
  async accept(auth: AuthContext, token: string): Promise<{ circleId: string }> {
    await this.limit(`invite-preview:${auth.userId}`, INVITE_LIMITS.previewsPerHour);
    return this.redeem(auth, hashToken(token), {});
  }

  /**
   * Comes in with a code (its hash). With "a yes for new people" (docs/ADR/0023 §5) it may wait for
   * a parent: the caller's own, when the caller is such a child (`own` skips it: that parent said
   * yes), and the code owner's, when the code was made by such a child (`admit` skips it).
   */
  async redeem(
    auth: Pick<AuthContext, 'userId'>,
    tokenHash: Uint8Array,
    approved: { own?: boolean; admit?: boolean },
  ): Promise<{ circleId: string }> {
    if (approved.own !== true) await this.askGuardians(auth.userId, tokenHash);
    if (approved.admit !== true) await this.askToAdmit(auth.userId, tokenHash);
    let counted: string | null = null;
    const { circleId, fresh } = await this.database
      .asUser(auth.userId, async (tx) => {
        // Someone 15-17 comes into an event only with a friend's code (docs/ADR/0023).
        const allowed = await tx.execute<{ ok: boolean }>(
          sql`SELECT app.may_redeem(${tokenHash}) AS ok`,
        );
        if (allowed.rows[0]?.ok !== true) {
          throw new ApiError(HttpStatus.FORBIDDEN, 'FRIEND_INVITE_ONLY');
        }
        const result = await tx.execute<{ joined_circle: string; fresh: boolean }>(
          sql`SELECT joined_circle, fresh FROM app.redeem_invite(${tokenHash})`,
        );
        const [row] = result.rows;
        if (row === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
        if (row.fresh) {
          await this.circles.limitJoins(row.joined_circle);
          counted = row.joined_circle;
          await this.circles.startEpoch(tx, row.joined_circle);
        }
        return { circleId: row.joined_circle, fresh: row.fresh };
      })
      .catch(async (error: unknown) => {
        // Rolled back: the slot it took comes back (QA Faz 9 slice 2, N2).
        if (counted !== null) await this.circles.refundJoin(counted);
        throw refusal(error);
      });
    if (!fresh) return { circleId };
    await this.circles.announce(auth.userId, circleId);
    // A friend code: its owner has a new friend. A circle link: the circle has a new member.
    const circle = await this.circles.get(auth, circleId);
    await this.notifier.notify(
      othersActive(circle, auth.userId),
      circle.kind === 'pair' ? 'friendAdded' : 'memberJoined',
      circle.id,
    );
    await this.circles.tellWatchingGuardians(auth.userId, circle.id);
    return { circleId };
  }

  /** The parents of a 15-17 child who needs their yes for this code: asked, and 403. */
  private async askGuardians(userId: string, tokenHash: Uint8Array): Promise<void> {
    const asked = await this.database
      .asUser(userId, (tx) =>
        tx.execute<{ guardian_id: string; fresh: boolean }>(
          sql`SELECT * FROM app.ask_guardians_for_invite(${tokenHash})`,
        ),
      )
      .catch((error: unknown) => {
        throw guardianRequestsFull(error);
      });
    await this.circles.tellAsked(userId, asked.rows);
    if (asked.rows.length > 0) throw new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_APPROVAL');
  }

  /**
   * The code was made by a 15-17 child whose parent says yes to new people (QA 5c F-2): the caller
   * waits for that yes. The answer says only that it waits, not whose or why.
   */
  private async askToAdmit(userId: string, tokenHash: Uint8Array): Promise<void> {
    const asked = await this.database
      .asUser(userId, (tx) =>
        tx.execute<{ guardian_id: string; child_id: string; fresh: boolean }>(
          sql`SELECT * FROM app.ask_guardians_to_admit(${tokenHash})`,
        ),
      )
      .catch((error: unknown) => {
        throw guardianRequestsFull(error);
      });
    const [first] = asked.rows;
    if (first === undefined) return;
    await this.circles.tellAsked(first.child_id, asked.rows);
    throw new ApiError(HttpStatus.FORBIDDEN, 'APPROVAL_PENDING');
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

  /**
   * The owner closes the door: every open link of the circle is revoked, whoever made it (a leaked
   * event QR, QA Faz 8 O2). Someone else than the owner gets 404, as for a circle they cannot see.
   */
  async revokeAll(auth: AuthContext, circleId: string): Promise<{ revoked: number }> {
    return this.database.asUser(auth.userId, async (tx) => {
      const circle = await this.circles.read(tx, circleId, auth.userId);
      if (circle?.myStatus !== 'active' || circle.myRole !== 'owner') {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      }
      const revoked = await tx
        .update(invites)
        .set({ revokedAt: new Date() })
        .where(and(eq(invites.circleId, circleId), isNull(invites.revokedAt)))
        .returning({ id: invites.id });
      return { revoked: revoked.length };
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
  if (message.includes('code already used by this person')) {
    return new ApiError(HttpStatus.CONFLICT, 'INVITE_USED');
  }
  if (message.includes('inviter left') || message.includes('predates the end')) {
    return new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
  }
  return error;
}
