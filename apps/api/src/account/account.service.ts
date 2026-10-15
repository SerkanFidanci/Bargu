import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  type AccountExport,
  HISTORY_CONSENT_VERSION,
  type HistoryConsent,
  PRIVACY_NOTICE_VERSION,
  type PrivacyState,
} from '@bargu/schemas';
import { and, count, eq, inArray, isNull, sql } from 'drizzle-orm';

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
  ) {}

  /**
   * Deletes an account. At once: out of every circle by the rules of leaving (a group or an event
   * goes on with another admin; a friendship ends for both), every device and session closed, the
   * account marked so sign-in refuses it. Then the purge deletes it for good (here right away, the
   * worker otherwise). Each step can run again: a request cut short is simply asked again.
   */
  async delete(userId: string): Promise<void> {
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

  /**
   * Explicit consent to location history, given for the version shown, or withdrawn. Without it
   * the server takes no history (history.service); withdrawing it, the phone turns history off
   * and deletes it everywhere.
   */
  async setHistoryConsent(auth: AuthContext, input: HistoryConsent): Promise<PrivacyState> {
    if (input.given && input.version !== HISTORY_CONSENT_VERSION) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    return this.database.asUser(auth.userId, async (tx) => {
      if (input.given) {
        await this.give(tx, auth.userId, 'history', input.version);
      } else {
        await tx
          .update(consents)
          .set({ withdrawnAt: new Date() })
          .where(
            and(
              eq(consents.userId, auth.userId),
              eq(consents.purpose, 'history'),
              isNull(consents.withdrawnAt),
            ),
          );
      }
      return this.readPrivacy(tx, auth.userId);
    });
  }

  private async give(tx: Tx, userId: string, purpose: 'notice' | 'history', version: number) {
    const now = new Date();
    await tx
      .insert(consents)
      .values({ userId, purpose, version, givenAt: now })
      .onConflictDoUpdate({
        target: [consents.userId, consents.purpose],
        set: { version, givenAt: now, withdrawnAt: null },
      });
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
