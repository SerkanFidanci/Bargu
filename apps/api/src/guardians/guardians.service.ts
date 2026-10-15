import { HttpStatus, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '@bargu/crypto';
import {
  AVATAR_EMOJIS,
  GUARDIAN_CODE_TTL_MS,
  GUARDIAN_END_AFTER_MS,
  type GuardianCode,
  type GuardianEnd,
  type GuardianLink,
  type GuardianPreview,
  type GuardianView,
  type PublicProfile,
} from '@bargu/schemas';
import { eq, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { CirclesService } from '../circles/circles.service.js';
import { ApiError } from '../common/api-error.js';
import { users } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { Notifier } from '../push/notifier.js';

const HOUR = 3600;
/** Codes shown and codes looked at, per account. */
export const GUARDIAN_LIMITS = { codesPerHour: 20, previewsPerHour: 60 } as const;
/** What the QR code and the shared link carry; opens the app at the parent's yes. */
export const guardianLink = (token: string) => `bargu://g/${token}`;

const emojis: ReadonlySet<string> = new Set(AVATAR_EMOJIS);

/** Row of app.my_guardian_links() (migrations/0021). */
interface LinkRow extends Record<string, unknown> {
  id: string;
  role: 'child' | 'guardian';
  status: 'confirming' | 'active';
  // Raw rows: timestamps come as text.
  created_at: string;
  active_at: string | null;
  end_requested_at: string | null;
  child_id: string;
  other_id: string;
  other_username: string | null;
  other_display_name: string | null;
  other_avatar_color: number | null;
  other_avatar_emoji: string | null;
}

interface CardRow extends Record<string, unknown> {
  username: string | null;
  display_name: string | null;
  avatar_color: number | null;
  avatar_emoji: string | null;
}

function card(row: CardRow): PublicProfile {
  return {
    username: row.username ?? '',
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

const ms = (value: string) => new Date(value).getTime();

function link(row: LinkRow): GuardianLink {
  const requested = row.end_requested_at === null ? null : ms(row.end_requested_at);
  return {
    id: row.id,
    role: row.role,
    status: row.status,
    other: card({
      username: row.other_username,
      display_name: row.other_display_name,
      avatar_color: row.other_avatar_color,
      avatar_emoji: row.other_avatar_emoji,
    }),
    createdAt: ms(row.created_at),
    activeAt: row.active_at === null ? null : ms(row.active_at),
    endRequestedAt: requested,
    endsAt: requested === null ? null : requested + GUARDIAN_END_AFTER_MS,
  };
}

/** The message of a refusal raised inside the functions of migration 0021, as an API error. */
function refusal(error: unknown): unknown {
  if (error instanceof ApiError) return error;
  const message = [error, error instanceof Error ? error.cause : undefined]
    .map((value) => (value instanceof Error ? value.message : ''))
    .join(' ');
  if (message.includes('only 15-17 adds a guardian')) {
    return new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_CHILD_ONLY');
  }
  if (message.includes('a guardian is 18+')) {
    return new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_ADULT_ONLY');
  }
  if (message.includes('guardian limit')) {
    return new ApiError(HttpStatus.CONFLICT, 'GUARDIAN_LIMIT');
  }
  if (message.includes('already a guardian')) {
    return new ApiError(HttpStatus.CONFLICT, 'ALREADY_GUARDIAN');
  }
  return error;
}

/**
 * Guardians (docs/ADR/0023 §4). The child (15-17) shows a code, a parent (18+, their own account)
 * takes it in person, the child says yes. Either side hears every change (an event, and a push to
 * the other side). The view shows the parent, and the child alike, the child's age band and who
 * could see the child's location; the location itself is never part of it.
 */
@Injectable()
export class GuardiansService {
  constructor(
    private readonly database: DatabaseService,
    private readonly circles: CirclesService,
    private readonly events: EventsService,
    private readonly notifier: Notifier,
    private readonly limiter: RateLimiter,
  ) {}

  /** "Ebeveyn ekle": a fresh code, valid 10 minutes; an earlier open one stops working. */
  async code(auth: AuthContext): Promise<GuardianCode> {
    await this.limit(`guardian-code:${auth.userId}`, GUARDIAN_LIMITS.codesPerHour);
    const token = generateToken();
    const expiresAt = Date.now() + GUARDIAN_CODE_TTL_MS;
    await this.database
      .asUser(auth.userId, (tx) =>
        tx.execute(sql`SELECT app.open_guardian_code(${hashToken(token)}, ${new Date(expiresAt)})`),
      )
      .catch((error: unknown) => {
        throw refusal(error);
      });
    return { token, link: guardianLink(token), expiresAt };
  }

  /** Whose code it is, before the parent says yes. Only someone 18+ may look. */
  async preview(auth: AuthContext, token: string): Promise<GuardianPreview> {
    await this.limit(`guardian-preview:${auth.userId}`, GUARDIAN_LIMITS.previewsPerHour);
    return this.database.asUser(auth.userId, async (tx) => {
      await this.mustBeAdult(tx, auth.userId);
      const found = await tx.execute<CardRow & { child_id: string }>(
        sql`SELECT * FROM app.guardian_code_child(${hashToken(token)})`,
      );
      const [row] = found.rows;
      if (row === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
      if (row.child_id === auth.userId) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_ADULT_ONLY');
      }
      return { child: card(row) };
    });
  }

  /** The parent's yes: the link now waits for the child's. */
  async accept(auth: AuthContext, token: string): Promise<GuardianLink> {
    await this.limit(`guardian-preview:${auth.userId}`, GUARDIAN_LIMITS.previewsPerHour);
    const taken = await this.database
      .asUser(auth.userId, async (tx) => {
        const result = await tx.execute<{ id: string | null }>(
          sql`SELECT app.take_guardian_code(${hashToken(token)}) AS id`,
        );
        const id = result.rows[0]?.id ?? null;
        if (id === null) throw new ApiError(HttpStatus.NOT_FOUND, 'INVITE_INVALID');
        return this.mustRead(tx, id);
      })
      .catch((error: unknown) => {
        throw refusal(error);
      });
    await this.changed([auth.userId, taken.row.child_id]);
    await this.notifier.notify([taken.row.child_id], 'guardianRequest', taken.link.id);
    return taken.link;
  }

  /** The child's yes: the link is active, and the parent hears it. */
  async confirm(auth: AuthContext, linkId: string): Promise<GuardianLink> {
    const confirmed = await this.database.asUser(auth.userId, async (tx) => {
      const result = await tx.execute<{ ok: boolean }>(
        sql`SELECT app.confirm_guardian(${linkId}) AS ok`,
      );
      if (result.rows[0]?.ok !== true) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return this.mustRead(tx, linkId);
    });
    await this.changed([auth.userId, confirmed.row.other_id]);
    await this.notifier.notify([confirmed.row.other_id], 'guardianLinked', linkId);
    return confirmed.link;
  }

  /**
   * Ends a link: the parent at once; the child at once while it is not active yet, otherwise it is
   * asked for and ends when the parent agrees or 7 days later (md. 9/4: never without the parent
   * knowing). The other side hears it either way.
   */
  async end(auth: AuthContext, linkId: string): Promise<GuardianEnd> {
    const { outcome, other } = await this.database.asUser(auth.userId, async (tx) => {
      const before = await this.read(tx, linkId);
      if (before === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const result = await tx.execute<{ outcome: 'ended' | 'requested' | null }>(
        sql`SELECT app.end_guardian(${linkId}) AS outcome`,
      );
      const done = result.rows[0]?.outcome ?? null;
      if (done === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return { outcome: done, other: before.row.other_id };
    });
    await this.changed([auth.userId, other]);
    if (outcome === 'ended') {
      await this.notifier.notify([other], 'guardianEnded', linkId);
      return { ended: true, endsAt: null };
    }
    await this.notifier.notify([other], 'guardianEndRequested', linkId);
    const now = await this.database.asUser(auth.userId, (tx) => this.read(tx, linkId));
    return { ended: false, endsAt: now?.link.endsAt ?? null };
  }

  async list(auth: AuthContext): Promise<GuardianLink[]> {
    return this.database.asUser(auth.userId, async (tx) => {
      const result = await tx.execute<LinkRow>(sql`SELECT * FROM app.my_guardian_links()`);
      return result.rows.map(link);
    });
  }

  /**
   * What the parent sees, and the child alike: the child's age band and the people in the child's
   * circles (who could see the child's location). Only for an active link, to either side.
   */
  async view(auth: AuthContext, linkId: string): Promise<GuardianView> {
    const found = await this.database.asUser(auth.userId, (tx) => this.read(tx, linkId));
    if (found?.link.status !== 'active') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    const childId = found.row.child_id;
    const { child, ageBand } = await this.database.asUser(childId, async (tx) => {
      const [row] = await tx
        .select({
          username: users.username,
          display_name: users.displayName,
          avatar_color: users.avatarColor,
          avatar_emoji: users.avatarEmoji,
          ageBand: users.ageBand,
        })
        .from(users)
        .where(eq(users.id, childId));
      if (row?.ageBand !== '15-17') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return { child: card(row), ageBand: row.ageBand };
    });
    const circles = await this.circles.list({ userId: childId });
    return {
      link: found.link,
      child,
      ageBand,
      circles: circles
        .filter((circle) => circle.myStatus === 'active')
        .map((circle) => ({
          kind: circle.kind,
          name: circle.name,
          members: circle.members
            .filter((member) => member.userId !== childId && member.status === 'active')
            .map((member) => ({ username: member.username, displayName: member.displayName })),
        })),
    };
  }

  /**
   * Before an account is deleted (docs/ADR/0022): the other sides of its links, to tell them once
   * the links are gone (the deletion ends them, migration 0021).
   */
  async othersOf(userId: string): Promise<string[]> {
    return this.database.asUser(userId, async (tx) => {
      const result = await tx.execute<LinkRow>(sql`SELECT * FROM app.my_guardian_links()`);
      return result.rows.map((row) => row.other_id);
    });
  }

  /** Links that ended without either side doing it (a deleted account, the worker). */
  async ended(userIds: string[]): Promise<void> {
    await this.changed(userIds);
  }

  private async read(tx: Tx, linkId: string) {
    const result = await tx.execute<LinkRow>(
      sql`SELECT * FROM app.my_guardian_links() WHERE id = ${linkId}`,
    );
    const [row] = result.rows;
    return row === undefined ? null : { row, link: link(row) };
  }

  private async mustRead(tx: Tx, linkId: string) {
    const found = await this.read(tx, linkId);
    if (found === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return found;
  }

  private async mustBeAdult(tx: Tx, userId: string): Promise<void> {
    const [me] = await tx
      .select({ ageBand: users.ageBand })
      .from(users)
      .where(eq(users.id, userId));
    if (me?.ageBand !== '18+') throw new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_ADULT_ONLY');
  }

  private async changed(userIds: Iterable<string>): Promise<void> {
    await this.events.publish(userIds, { type: 'guardians.changed' });
  }

  private async limit(key: string, budget: number): Promise<void> {
    const result = await this.limiter.hit(key, budget, HOUR);
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }
}
