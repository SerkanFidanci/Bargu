import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  type AccountExport,
  type AgeBand,
  type AgeState,
  COMMUNITY_RULES_VERSION,
  type FindableState,
  HISTORY_CONSENT_VERSION,
  type HistoryConsent,
  PRIVACY_NOTICE_VERSION,
  type PrivacyState,
  type RulesState,
} from '@bargu/schemas';
import { and, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { CirclesService } from '../circles/circles.service.js';
import { ApiError } from '../common/api-error.js';
import {
  circleMembers,
  circles,
  consents,
  devices,
  historyChunks,
  passkeys,
  pushTokens,
  refreshTokens,
  securityEvents,
  users,
} from '../db/schema.js';
import { DeviceLifecycle } from '../devices/device-lifecycle.js';
import { EventsService } from '../events/events.service.js';
import { GuardiansService } from '../guardians/guardians.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { AccountPurge } from './account-purge.js';

const HOUR = 3600;
/** "Verilerimi indir" a few times an hour: it reads the whole account. */
export const EXPORT_PER_HOUR = 5;

/**
 * The account as its owner controls it (docs/ADR/0022): deleting it, taking a copy of it, and the
 * KVKK records (the information notice read, explicit consent to location history).
 */
@Injectable()
export class AccountService {
  private readonly logger = new Logger('Account');

  constructor(
    private readonly database: DatabaseService,
    private readonly circles: CirclesService,
    private readonly lifecycle: DeviceLifecycle,
    private readonly purge: AccountPurge,
    private readonly limiter: RateLimiter,
    private readonly events: EventsService,
    private readonly guardians: GuardiansService,
  ) {}

  /**
   * Deletes an account. At once: out of every circle by the rules of leaving (a group or an event
   * goes on with another admin; a friendship ends for both), every device and session closed, the
   * account marked so sign-in refuses it. Then the purge deletes it for good (here right away, the
   * worker otherwise). Each step can run again: a request cut short is simply asked again.
   */
  async delete(userId: string): Promise<void> {
    // Its guardian links end with it (migration 0021); the other sides are told below.
    const linked = await this.guardians.othersOf(userId);
    const memberships = await this.database.asUser(userId, (tx) =>
      tx
        .select({ circleId: circleMembers.circleId, status: circleMembers.status })
        .from(circleMembers)
        .where(
          and(
            eq(circleMembers.userId, userId),
            inArray(circleMembers.status, ['active', 'invited']),
          ),
        ),
    );
    for (const { circleId, status } of memberships) {
      if (status === 'active') await this.circles.leave({ userId }, circleId);
      else await this.circles.decline({ userId }, circleId);
    }

    const closed = await this.database.asUser(userId, async (tx) => {
      const now = new Date();
      const rows = await tx
        .update(devices)
        .set({ revokedAt: now, revokedReason: 'account_deleted' })
        .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
        .returning({ id: devices.id });
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
      await tx.delete(pushTokens).where(eq(pushTokens.userId, userId));
      return rows.map((row) => row.id);
    });
    for (const deviceId of closed) {
      await this.lifecycle.notify({
        userId,
        kind: 'revoked',
        deviceId,
        newDevice: false,
        replacedDeviceId: null,
      });
    }

    await this.database.asUser(userId, (tx) =>
      tx.execute(sql`SELECT app.request_account_deletion()`),
    );
    if (linked.length > 0) await this.guardians.ended(linked);
    try {
      await this.purge.sweep();
    } catch (error) {
      // Unusable already; what is left goes with the worker's next round.
      this.logger.warn(`purge deferred: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }

  /** What the server holds of the account ("Verilerimi indir"); its own rows only. */
  async export(auth: AuthContext): Promise<AccountExport> {
    const hit = await this.limiter.hit(`export:${auth.userId}`, EXPORT_PER_HOUR, HOUR);
    if (!hit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', hit.retryAfter);
    }
    return this.database.asUser(auth.userId, async (tx) => {
      const [user] = await tx.select().from(users).where(eq(users.id, auth.userId));
      if (user === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const phones = await tx
        .select()
        .from(devices)
        .where(eq(devices.userId, auth.userId))
        .orderBy(devices.createdAt);
      const memberships = await tx
        .select({
          id: circles.id,
          kind: circles.kind,
          name: circles.name,
          role: circleMembers.role,
          status: circleMembers.status,
          joinedAt: circleMembers.joinedAt,
        })
        .from(circleMembers)
        .innerJoin(circles, eq(circles.id, circleMembers.circleId))
        .where(
          and(
            eq(circleMembers.userId, auth.userId),
            inArray(circleMembers.status, ['active', 'invited']),
          ),
        );
      const events = await tx
        .select({ type: securityEvents.type, at: securityEvents.createdAt })
        .from(securityEvents)
        .where(eq(securityEvents.userId, auth.userId))
        .orderBy(securityEvents.createdAt);
      const [keys] = await tx
        .select({ total: count() })
        .from(passkeys)
        .where(eq(passkeys.userId, auth.userId));
      const [push] = await tx
        .select({ total: count() })
        .from(pushTokens)
        .where(eq(pushTokens.userId, auth.userId));
      const [pieces] = await tx
        .select({ total: count() })
        .from(historyChunks)
        .where(eq(historyChunks.userId, auth.userId));
      return {
        account: {
          userId: user.id,
          username: user.username,
          displayName: user.displayName,
          avatar:
            user.avatarColor === null ? null : { color: user.avatarColor, emoji: user.avatarEmoji },
          createdAt: user.createdAt.getTime(),
        },
        devices: phones.map((phone) => ({
          platform: phone.platform,
          createdAt: phone.createdAt.getTime(),
          lastSeenAt: phone.lastSeenAt.getTime(),
          revokedAt: phone.revokedAt?.getTime() ?? null,
          revokedReason: phone.revokedReason,
        })),
        circles: memberships.flatMap((circle) =>
          circle.status === 'active' || circle.status === 'invited'
            ? [
                {
                  id: circle.id,
                  kind: circle.kind,
                  name: circle.name,
                  role: circle.role,
                  status: circle.status,
                  joinedAt: circle.joinedAt?.getTime() ?? null,
                },
              ]
            : [],
        ),
        securityEvents: events.map((event) => ({ type: event.type, at: event.at.getTime() })),
        passkeys: keys?.total ?? 0,
        pushRegistered: (push?.total ?? 0) > 0,
        historyPieces: pieces?.total ?? 0,
        privacy: await this.readPrivacy(tx, auth.userId),
      };
    });
  }

  privacy(auth: AuthContext): Promise<PrivacyState> {
    return this.database.asUser(auth.userId, (tx) => this.readPrivacy(tx, auth.userId));
  }

  /** "Okudum, anladım": the information notice of this version was shown and read. */
  async readNotice(auth: AuthContext, version: number): Promise<PrivacyState> {
    if (version > PRIVACY_NOTICE_VERSION)
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    return this.database.asUser(auth.userId, async (tx) => {
      await this.give(tx, auth.userId, 'notice', version);
      return this.readPrivacy(tx, auth.userId);
    });
  }

  /** The community rules this account accepted, and which version (K14). */
  rules(auth: AuthContext): Promise<RulesState> {
    return this.database.asUser(auth.userId, (tx) => this.readRules(tx, auth.userId));
  }

  /**
   * "Kabul ediyorum" under the community rules (K14): only the version the app shows now. Until
   * then messages and photos are refused (messages.service).
   */
  async acceptRules(auth: AuthContext, version: number): Promise<RulesState> {
    if (version !== COMMUNITY_RULES_VERSION) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    return this.database.asUser(auth.userId, async (tx) => {
      await this.give(tx, auth.userId, 'rules', version);
      return this.readRules(tx, auth.userId);
    });
  }

  /**
   * Explicit consent to location history, given for the version shown, or withdrawn. Without it
   * the server takes no history (history.service); withdrawing it, the phone turns history off
   * and deletes it everywhere.
   */
  async setHistoryConsent(auth: AuthContext, input: HistoryConsent): Promise<PrivacyState> {
    if (input.given && input.version !== HISTORY_CONSENT_VERSION) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    const { state, told } = await this.database.asUser(auth.userId, async (tx) => {
      if (input.given) {
        // 15-17: no location history at all (docs/ADR/0023).
        if ((await this.ageOf(tx, auth.userId))?.band === '15-17') {
          throw new ApiError(HttpStatus.FORBIDDEN, 'AGE_RESTRICTED');
        }
        await this.give(tx, auth.userId, 'history', input.version);
        return { state: await this.readPrivacy(tx, auth.userId), told: [] };
      }
      const dropped = await this.withdrawHistory(tx, auth.userId);
      return { state: await this.readPrivacy(tx, auth.userId), told: dropped };
    });
    this.tellHistoryGone(auth.userId, told);
    return state;
  }

  /** The account's age band (docs/ADR/0023). */
  age(auth: AuthContext): Promise<AgeState> {
    return this.database.asUser(auth.userId, async (tx) => ({
      age: await this.ageOf(tx, auth.userId),
    }));
  }

  /**
   * Says the age band: once for an account that never did, or 18+ to 15-17 at any time. Older than
   * said needs a person to look (or, later, the e-Devlet age token): 403 AGE_REVIEW_REQUIRED.
   * Becoming 15-17 ends location history like withdrawn consent.
   */
  async setAge(auth: AuthContext, band: AgeBand): Promise<AgeState> {
    const { state, told } = await this.database.asUser(auth.userId, async (tx) => {
      const [me] = await tx
        .select({ band: users.ageBand, method: users.ageMethod })
        .from(users)
        .where(eq(users.id, auth.userId))
        .for('update');
      if (me === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
      if (me.band === band) return { state: { age: await this.ageOf(tx, auth.userId) }, told: [] };
      if (me.method === 'token' || me.band === '15-17') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'AGE_REVIEW_REQUIRED');
      }
      await tx
        .update(users)
        .set({ ageBand: band, ageMethod: 'declared', ageSetAt: new Date() })
        .where(eq(users.id, auth.userId));
      const dropped = band === '15-17' ? await this.withdrawHistory(tx, auth.userId) : [];
      return { state: { age: await this.ageOf(tx, auth.userId) }, told: dropped };
    });
    this.tellHistoryGone(auth.userId, told);
    if (state.age?.band === '15-17') {
      // Invitations by username from before: nobody finds 15-17 by username any more, so none
      // comes in around a parent's yes (QA 5c, old invitations).
      const waiting = await this.database.asUser(auth.userId, (tx) =>
        tx
          .select({ circleId: circleMembers.circleId })
          .from(circleMembers)
          .where(and(eq(circleMembers.userId, auth.userId), eq(circleMembers.status, 'invited'))),
      );
      for (const { circleId } of waiting) await this.circles.decline(auth, circleId);
    }
    return state;
  }

  /** "Kullanıcı adımla bulunabilirim" (docs/ADR/0023). */
  findable(auth: AuthContext): Promise<FindableState> {
    return this.database.asUser(auth.userId, (tx) => this.findableOf(tx, auth.userId));
  }

  /** On or off; 15-17 cannot turn it on (403 AGE_RESTRICTED). */
  async setFindable(auth: AuthContext, findable: boolean): Promise<FindableState> {
    return this.database.asUser(auth.userId, async (tx) => {
      const before = await this.findableOf(tx, auth.userId);
      if (findable && before.locked) throw new ApiError(HttpStatus.FORBIDDEN, 'AGE_RESTRICTED');
      await tx.update(users).set({ findable }).where(eq(users.id, auth.userId));
      return this.findableOf(tx, auth.userId);
    });
  }

  private async findableOf(tx: Tx, userId: string): Promise<FindableState> {
    const [row] = await tx
      .select({ findable: users.findable, band: users.ageBand })
      .from(users)
      .where(eq(users.id, userId));
    if (row === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    return { findable: row.findable, locked: row.band === '15-17' };
  }

  private async ageOf(tx: Tx, userId: string): Promise<AgeState['age']> {
    const [row] = await tx
      .select({ band: users.ageBand, method: users.ageMethod, at: users.ageSetAt })
      .from(users)
      .where(eq(users.id, userId));
    // The three are set together (a check in migration 0020).
    if (row?.band === undefined || row.band === null || row.method === null || row.at === null) {
      return null;
    }
    return { band: row.band, method: row.method, at: row.at.getTime() };
  }

  /**
   * Withdraws consent to history and deletes the trail in the same step: a phone that is offline
   * cannot leave it readable to its circles (QA Faz 9 slice 4, K3). Returns who to tell.
   */
  private async withdrawHistory(tx: Tx, userId: string) {
    await tx
      .update(consents)
      .set({ withdrawnAt: new Date() })
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.purpose, 'history'),
          isNull(consents.withdrawnAt),
        ),
      );
    const dropped = await tx
      .delete(historyChunks)
      .where(eq(historyChunks.userId, userId))
      .returning({ circleId: historyChunks.circleId });
    const circleIds = [...new Set(dropped.map((row) => row.circleId))];
    if (circleIds.length === 0) return [];
    return tx
      .select({ circleId: circleMembers.circleId, userId: circleMembers.userId })
      .from(circleMembers)
      .where(
        and(
          inArray(circleMembers.circleId, circleIds),
          eq(circleMembers.status, 'active'),
          ne(circleMembers.userId, userId),
        ),
      );
  }

  /** Whoever has the circle's history open sees the trail go, as with "Geçmişimi sil". */
  private tellHistoryGone(userId: string, told: { circleId: string; userId: string }[]): void {
    const byCircle = new Map<string, string[]>();
    for (const member of told) {
      byCircle.set(member.circleId, [...(byCircle.get(member.circleId) ?? []), member.userId]);
    }
    for (const [circleId, userIds] of byCircle) {
      this.events.emitLive(userIds, 'history', { circleId, userId });
    }
  }

  private async give(
    tx: Tx,
    userId: string,
    purpose: 'notice' | 'history' | 'rules',
    version: number,
  ) {
    const now = new Date();
    await tx
      .insert(consents)
      .values({ userId, purpose, version, givenAt: now })
      .onConflictDoUpdate({
        target: [consents.userId, consents.purpose],
        set: { version, givenAt: now, withdrawnAt: null },
      });
  }

  private async readRules(tx: Tx, userId: string): Promise<RulesState> {
    const [row] = await tx
      .select()
      .from(consents)
      .where(and(eq(consents.userId, userId), eq(consents.purpose, 'rules')));
    if (row?.withdrawnAt !== null) return { rules: null };
    return { rules: { version: row.version, at: row.givenAt.getTime() } };
  }

  private async readPrivacy(tx: Tx, userId: string): Promise<PrivacyState> {
    const rows = await tx.select().from(consents).where(eq(consents.userId, userId));
    const of = (purpose: 'notice' | 'history') => {
      const row = rows.find((candidate) => candidate.purpose === purpose);
      if (row === undefined) return null;
      return row.withdrawnAt === null ? { version: row.version, at: row.givenAt.getTime() } : null;
    };
    return { notice: of('notice'), history: of('history') };
  }
}
