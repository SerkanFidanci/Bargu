import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { generateToken, hashToken } from '@bargu/crypto';
import {
  AVATAR_EMOJIS,
  CLIENT_LEVEL_FOR,
  cosmeticProductSchema,
  GUARDIAN_CODE_TTL_MS,
  GUARDIAN_END_AFTER_MS,
  type GuardianCode,
  type GuardianEnd,
  type GuardianLink,
  type GuardianPreview,
  type GuardianRequest,
  type GuardianRules,
  type GuardianSettings,
  type GuardianView,
  type PublicProfile,
  type UsageReport,
} from '@bargu/schemas';
import { eq, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { BillingService } from '../billing/billing.service.js';
import { CirclesService } from '../circles/circles.service.js';
import { InvitesService } from '../circles/invites.service.js';
import { ApiError } from '../common/api-error.js';
import { ENV } from '../config/config.module.js';
import { type Env, inviteHostOf } from '../config/env.js';
import { users } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { Notifier } from '../push/notifier.js';

const HOUR = 3600;
/** How long someone who came into the child's circles shows as new on the view. */
export const NEW_MEMBER_MS = 7 * 24 * 3600_000;
/** Codes shown and codes looked at, per account. */
export const GUARDIAN_LIMITS = { codesPerHour: 20, previewsPerHour: 60, usagePerHour: 60 } as const;
/**
 * What the QR code and the shared link carry; opens the app at the parent's yes. Like an invite
 * (invites.service inviteLink), the invite page's own address with the token in the fragment:
 * `https://<host>/g#<token>` (docs/ADR/0009 Ek 2).
 */
export const guardianLink = (host: string, token: string) => `https://${host}/g#${token}`;

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

/** What a waiting request is (migrations/0031, 0037). */
type RequestKind = 'invite' | 'friend' | 'admit' | 'member' | 'purchase' | 'cosmetic';
/** What a purchase or a cosmetic request asks for: a plan, or a pack as `cosmetic:<pack>`. */
type RequestProduct = 'plus_month' | 'plus_year' | `cosmetic:${string}`;

/** Row of app.take_guardian_request() (migrations/0031): the request a parent answers. */
interface TakenRequest extends Record<string, unknown> {
  child_id: string;
  kind: RequestKind;
  token_hash: Buffer | null;
  username: string | null;
  newcomer_id: string | null;
  circle_id: string | null;
  product: RequestProduct | null;
}

/**
 * From which app level a kind of request is sent (docs/ADR/0024 §10): an older app, which cannot
 * show it, is not sent it.
 */
function readableFrom(kind: GuardianRequest['kind']): number {
  switch (kind) {
    case 'purchase':
      return CLIENT_LEVEL_FOR.purchaseRequests;
    case 'cosmetic':
      return CLIENT_LEVEL_FOR.cosmeticRequests;
    default:
      return 0;
  }
}

/** Row of app.guardian_requests_of() (migrations/0037). */
interface RequestRow extends Record<string, unknown> {
  id: string;
  kind: RequestKind;
  circle_kind: 'pair' | 'friends' | 'family' | 'event' | null;
  circle_name: string | null;
  member_count: number | null;
  code_works: boolean;
  inviter_display_name: string | null;
  other_display_name: string | null;
  product: RequestProduct | null;
  created_at: string;
}

/** A waiting request as both sides see it: display names only (QA 5b G-1). */
function request(row: RequestRow): GuardianRequest {
  const base = {
    id: row.id,
    memberCount: row.member_count,
    createdAt: new Date(row.created_at).getTime(),
  };
  const circle = row.circle_kind === null || row.circle_kind === 'pair' ? null : row.circle_kind;
  switch (row.kind) {
    case 'purchase':
      return row.product === 'plus_month' || row.product === 'plus_year'
        ? { ...base, kind: 'purchase', name: null, by: null, product: row.product }
        : { ...base, kind: 'gone', name: null, by: null };
    case 'cosmetic':
      return row.product?.startsWith('cosmetic:') === true
        ? {
            ...base,
            kind: 'cosmetic',
            name: null,
            by: null,
            pack: row.product.slice('cosmetic:'.length),
          }
        : { ...base, kind: 'gone', name: null, by: null };
    case 'friend':
      return { ...base, kind: 'friend', name: row.other_display_name, by: null };
    case 'member':
      return { ...base, kind: 'invites', name: row.circle_name, by: row.other_display_name };
    case 'admit':
      if (!row.code_works) return { ...base, kind: 'gone', name: null, by: null };
      return circle === null
        ? { ...base, kind: 'befriends', name: null, by: row.other_display_name }
        : { ...base, kind: 'joins', name: row.circle_name, by: row.other_display_name };
    case 'invite':
      if (!row.code_works) return { ...base, kind: 'gone', name: null, by: null };
      return circle === null
        ? { ...base, kind: 'friend', name: row.inviter_display_name, by: row.inviter_display_name }
        : {
            ...base,
            kind: circle === 'event' ? 'event' : 'group',
            name: row.circle_name,
            by: row.inviter_display_name,
          };
  }
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
    private readonly invites: InvitesService,
    private readonly events: EventsService,
    private readonly notifier: Notifier,
    private readonly limiter: RateLimiter,
    private readonly billing: BillingService,
    @Inject(ENV) private readonly env: Env,
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
    return { token, link: guardianLink(inviteHostOf(this.env), token), expiresAt };
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
    const { outcome, other, child } = await this.database.asUser(auth.userId, async (tx) => {
      const before = await this.read(tx, linkId);
      if (before === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const result = await tx.execute<{ outcome: 'ended' | 'requested' | null }>(
        sql`SELECT app.end_guardian(${linkId}) AS outcome`,
      );
      const done = result.rows[0]?.outcome ?? null;
      if (done === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return { outcome: done, other: before.row.other_id, child: before.row.child_id };
    });
    await this.changed([auth.userId, other]);
    if (outcome === 'ended') {
      // The child's last parent going takes what waited for a yes with it (a plan, a pack): the
      // child's plan, which says what waits, is read again.
      await this.events.publish([child], { type: 'plan.changed' });
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
  /**
   * The view both sides share, as far as the caller's app can read it: a purchase request only to
   * level 2 and newer, a cosmetic one only to level 4 and newer (older ones cannot read the kind,
   * ADR 0024 §10).
   */
  async view(auth: AuthContext, linkId: string, clientLevel: number): Promise<GuardianView> {
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
    // Who came into the child's circles lately (7 days, since the link): marked new.
    const since = Math.max(found.link.activeAt ?? 0, Date.now() - NEW_MEMBER_MS);
    const recent = await this.database.asUser(childId, (tx) =>
      tx.execute<{ circle_id: string; user_id: string }>(
        sql`SELECT circle_id, user_id FROM app.circle_members
             WHERE status = 'active' AND user_id <> ${childId} AND joined_at > ${new Date(since)}`,
      ),
    );
    const fresh = new Set(recent.rows.map((row) => `${row.circle_id}:${row.user_id}`));
    const tools = await this.database.asUser(auth.userId, (tx) => this.toolsOf(tx, childId));
    return {
      link: found.link,
      child,
      ageBand,
      settings: tools.settings ?? {
        approveNewPeople: true,
        dailyLimitMinutes: null,
        updatedAt: found.link.activeAt ?? found.link.createdAt,
        updatedBy: null,
      },
      usage: tools.usage,
      requests: tools.requests.filter((request) => clientLevel >= readableFrom(request.kind)),
      circles: circles
        .filter((circle) => circle.myStatus === 'active')
        .map((circle) => ({
          kind: circle.kind,
          name: circle.name,
          members: circle.members
            .filter((member) => member.userId !== childId && member.status === 'active')
            // Display names only (QA 5b G-1): a parent cannot look these people up.
            .map((member) => ({
              displayName: member.displayName,
              isNew: fresh.has(`${circle.id}:${member.userId}`),
            })),
        })),
    };
  }

  /**
   * A parent sets the child's settings (docs/ADR/0023 §5); the child and the other parent hear it,
   * the child as a notification too.
   */
  async setSettings(
    auth: AuthContext,
    linkId: string,
    settings: GuardianSettings,
    clientLevel: number,
  ): Promise<GuardianView> {
    const childId = await this.database.asUser(auth.userId, async (tx) => {
      const found = await this.read(tx, linkId);
      if (found?.link.status !== 'active' || found.link.role !== 'guardian') {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      }
      const result = await tx.execute<{ ok: boolean }>(
        sql`SELECT app.set_guardian_settings(${found.row.child_id}, ${settings.approveNewPeople}, ${settings.dailyLimitMinutes}) AS ok`,
      );
      if (result.rows[0]?.ok !== true) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return found.row.child_id;
    });
    await this.changed([childId, ...(await this.parentsOf(childId))]);
    await this.notifier.notify([childId], 'guardianSettings', linkId);
    return this.view(auth, linkId, clientLevel);
  }

  /**
   * A parent answers what the child asked for: yes does it as the child (the code or the friend
   * request), no drops it. Either way the request is gone and the child hears the answer. A yes
   * whose code or name stopped working is 409 REQUEST_FAILED.
   */
  async answer(
    auth: AuthContext,
    linkId: string,
    requestId: string,
    yes: boolean,
  ): Promise<{ done: boolean }> {
    const taken = await this.database.asUser(auth.userId, async (tx) => {
      const found = await this.read(tx, linkId);
      if (found?.link.status !== 'active' || found.link.role !== 'guardian') {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      }
      const result = await tx.execute<TakenRequest>(
        sql`SELECT * FROM app.take_guardian_request(${requestId})`,
      );
      const [row] = result.rows;
      if (row?.child_id !== found.row.child_id) {
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      }
      return row;
    });
    const childId = taken.child_id;
    let done = false;
    if (yes) {
      try {
        await this.carryOut(taken);
        done = true;
      } catch (error) {
        // The way in now waits for another child's parent (two 15-17s): this yes is given.
        // Otherwise the code expired, the circle filled up, the name is gone: nothing to do.
        done = error instanceof ApiError && error.code === 'APPROVAL_PENDING';
      }
    }
    // A purchase or a pack said no to (or that could not be made): the child's Bargu+ and look
    // screens hear it too, and stop waiting.
    if ((taken.kind === 'purchase' || taken.kind === 'cosmetic') && !done) {
      await this.billing.purchaseDeclined(childId);
    }
    await this.changed([childId, ...(await this.parentsOf(childId))]);
    await this.notifier.notify([childId], done ? 'guardianApproved' : 'guardianDeclined', linkId);
    if (yes && !done) throw new ApiError(HttpStatus.CONFLICT, 'REQUEST_FAILED');
    return { done };
  }

  /** Does what a parent said yes to, as whoever asked for it. */
  private async carryOut(taken: TakenRequest): Promise<void> {
    const child = { userId: taken.child_id };
    const hash = taken.token_hash === null ? null : new Uint8Array(taken.token_hash);
    if (taken.kind === 'invite' && hash !== null) {
      await this.invites.redeem(child, hash, { own: true });
    } else if (taken.kind === 'friend' && taken.username !== null) {
      await this.circles.requestFriend(child, taken.username, true);
    } else if (taken.kind === 'admit' && hash !== null && taken.newcomer_id !== null) {
      // The newcomer comes in with the child's code; their own parent (if any) already said yes.
      await this.invites.redeem({ userId: taken.newcomer_id }, hash, { own: true, admit: true });
    } else if (taken.kind === 'member' && taken.circle_id !== null && taken.username !== null) {
      await this.circles.inviteUser(child, taken.circle_id, taken.username, true);
    } else if (
      taken.kind === 'purchase' &&
      (taken.product === 'plus_month' || taken.product === 'plus_year')
    ) {
      // Bought as the child (docs/ADR/0024 §5); their circles hear it if one opens.
      await this.billing.buyApproved(child.userId, taken.product);
    } else if (taken.kind === 'cosmetic') {
      // A pack, as the child (docs/ADR/0025 §6); only one this server sells, whatever the row says.
      const pack = cosmeticProductSchema.safeParse(taken.product);
      if (!pack.success) throw new ApiError(HttpStatus.CONFLICT, 'REQUEST_FAILED');
      await this.billing.buyApproved(child.userId, pack.data);
    } else {
      throw new ApiError(HttpStatus.CONFLICT, 'REQUEST_FAILED');
    }
  }

  /** The child's own rules, as the phone applies them (docs/ADR/0023 §5). */
  async rules(auth: AuthContext): Promise<GuardianRules> {
    return this.database.asUser(auth.userId, async (tx) => {
      const linked = await tx.execute<{ id: string }>(
        sql`SELECT id FROM app.my_guardian_links() WHERE role = 'child' AND status = 'active'`,
      );
      if (linked.rows.length === 0) return { linked: false, settings: null };
      const settings = (await this.toolsOf(tx, auth.userId)).settings;
      return {
        linked: true,
        settings:
          settings === null
            ? { approveNewPeople: true, dailyLimitMinutes: null }
            : {
                approveNewPeople: settings.approveNewPeople,
                dailyLimitMinutes: settings.dailyLimitMinutes,
              },
      };
    });
  }

  /**
   * The minutes the app was open on a day, from the child's phone; kept only while a parent is
   * linked (the last 7 days). The parents' views follow.
   */
  async recordUsage(auth: AuthContext, report: UsageReport): Promise<void> {
    await this.limit(`guardian-usage:${auth.userId}`, GUARDIAN_LIMITS.usagePerHour);
    const told = await this.database.asUser(auth.userId, (tx) =>
      tx.execute<{ guardian: string }>(
        sql`SELECT app.record_usage(${report.day}::date, ${report.minutes}) AS guardian`,
      ),
    );
    const parents = told.rows.map((row) => row.guardian);
    if (parents.length > 0) await this.changed(parents);
  }

  /** Settings, minutes and waiting requests of a child, as the caller (the child or a parent). */
  private async toolsOf(tx: Tx, childId: string) {
    const settings = await tx.execute<{
      approve_new_people: boolean;
      daily_limit_minutes: number | null;
      updated_at: string;
      updated_by: string | null;
    }>(sql`SELECT * FROM app.guardian_settings_of(${childId})`);
    const usage = await tx.execute<{ day: string; minutes: number }>(
      sql`SELECT to_char(day, 'YYYY-MM-DD') AS day, minutes FROM app.usage_days
           WHERE child_id = ${childId} AND day >= current_date - 6 ORDER BY day`,
    );
    const requests = await tx.execute<RequestRow>(
      sql`SELECT * FROM app.guardian_requests_of(${childId})`,
    );
    const [row] = settings.rows;
    return {
      settings:
        row === undefined
          ? null
          : {
              approveNewPeople: row.approve_new_people,
              dailyLimitMinutes: row.daily_limit_minutes,
              updatedAt: new Date(row.updated_at).getTime(),
              updatedBy: row.updated_by,
            },
      usage: usage.rows.map((day) => ({ day: day.day, minutes: day.minutes })),
      requests: requests.rows.map(request),
    };
  }

  /** The child's active parents, read as the child. */
  private async parentsOf(childId: string): Promise<string[]> {
    return this.database.asUser(childId, async (tx) => {
      const result = await tx.execute<LinkRow>(
        sql`SELECT * FROM app.my_guardian_links() WHERE role = 'child' AND status = 'active'`,
      );
      return result.rows.map((row) => row.other_id);
    });
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
    // A child's waiting purchase or pack went with the link: their plan is read again.
    await this.events.publish(userIds, { type: 'plan.changed' });
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
