import { HttpStatus, Injectable } from '@nestjs/common';
import { verifyHistoryEnvelope } from '@bargu/crypto';
import {
  HISTORY_CONSENT_VERSION,
  HISTORY_KEEP_MS,
  HISTORY_SLOT_MS,
  type HistoryEnvelope,
  historyEnvelopeSchema,
  type HistoryRecord,
} from '@bargu/schemas';
import { and, asc, eq, gte, isNull, lt } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { circleMembers, circles, consents, historyChunks } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

/**
 * Pieces per user: a quarter hour per circle normally; a phone that was offline sends what
 * waited, a little at a time.
 */
export const HISTORY_LIMITS = {
  puts: { limit: 120, windowSeconds: 60 },
  /** Reads per user: a day of someone's history at a time, as the app asks (QA Faz 8 G3). */
  lists: { limit: 30, windowSeconds: 60 },
  /** At most this much history in one answer (the app asks for one day). */
  maxRangeMs: 2 * 24 * 60 * 60_000,
} as const;

/**
 * Location history (docs/ADR/0019): each member's trail in quarter hours, sealed on their phone for
 * one circle with the history key of an epoch they were in. The server checks the signature (the
 * caller's device), the membership and the quarter hour, keeps the pieces two weeks (the worker
 * deletes older ones) and gives each member only the pieces from when they joined (row-level
 * security). Members on the circle's screen hear about a new piece live.
 */
@Injectable()
export class HistoryService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
  ) {}

  async put(
    auth: AuthContext,
    circleId: string,
    slot: number,
    envelope: HistoryEnvelope,
  ): Promise<void> {
    await this.limit(auth);
    const now = Date.now();
    if (
      slot % HISTORY_SLOT_MS !== 0 ||
      slot > now ||
      slot < now - HISTORY_KEEP_MS ||
      envelope.circleId !== circleId ||
      envelope.senderDeviceId !== auth.deviceId ||
      !verifyHistoryEnvelope(envelope, auth.identityKey)
    ) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    const others = await this.database.asUser(auth.userId, async (tx) => {
      // Location history rests on explicit consent (KVKK, docs/ADR/0022): not on the phone's word.
      const [consent] = await tx
        .select({ version: consents.version })
        .from(consents)
        .where(
          and(
            eq(consents.userId, auth.userId),
            eq(consents.purpose, 'history'),
            isNull(consents.withdrawnAt),
          ),
        );
      if (consent === undefined || consent.version < HISTORY_CONSENT_VERSION) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'CONSENT_REQUIRED');
      }
      const members = await this.activeMembers(tx, circleId);
      const epoch = members.find((member) => member.userId === auth.userId)?.epoch;
      if (epoch === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      // Sealed in an epoch the trail was recorded in: never one that has not begun.
      if (envelope.epoch > epoch) throw new ApiError(HttpStatus.CONFLICT, 'EPOCH_STALE');
      await tx
        .insert(historyChunks)
        .values({ circleId, userId: auth.userId, slot: new Date(slot), envelope })
        .onConflictDoUpdate({
          target: [historyChunks.circleId, historyChunks.userId, historyChunks.slot],
          set: { envelope, createdAt: new Date() },
        });
      return members.filter((member) => member.userId !== auth.userId).map((m) => m.userId);
    });
    this.events.emitLive(others, 'history', { circleId, userId: auth.userId });
  }

  /** A member's pieces between two moments (row-level security: from when the caller joined). */
  async list(
    auth: AuthContext,
    circleId: string,
    userId: string,
    range: { from: number; to: number },
  ): Promise<HistoryRecord[]> {
    if (range.to - range.from > HISTORY_LIMITS.maxRangeMs) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    await this.limit(auth, 'lists');
    const from = Math.max(range.from, Date.now() - HISTORY_KEEP_MS);
    const rows = await this.database.asUser(auth.userId, (tx) =>
      tx
        .select({ slot: historyChunks.slot, envelope: historyChunks.envelope })
        .from(historyChunks)
        .where(
          and(
            eq(historyChunks.circleId, circleId),
            eq(historyChunks.userId, userId),
            gte(historyChunks.slot, new Date(from)),
            lt(historyChunks.slot, new Date(range.to)),
          ),
        )
        .orderBy(asc(historyChunks.slot)),
    );
    return rows.flatMap((row) => {
      const envelope = historyEnvelopeSchema.safeParse(row.envelope);
      return envelope.success
        ? [{ userId, from: row.slot.getTime(), envelope: envelope.data }]
        : [];
    });
  }

  /**
   * Deletes the caller's own trail in every circle ("Geçmişimi de sil"), also what an earlier
   * install of the app wrote and this one no longer knows of (QA Faz 8 G5).
   */
  async removeAll(auth: AuthContext): Promise<void> {
    await this.limit(auth);
    const told = await this.database.asUser(auth.userId, async (tx) => {
      const dropped = await tx
        .delete(historyChunks)
        .where(eq(historyChunks.userId, auth.userId))
        .returning({ circleId: historyChunks.circleId });
      const circleIds = [...new Set(dropped.map((row) => row.circleId))];
      const perCircle: [string, string[]][] = [];
      for (const circleId of circleIds) {
        const members = await this.activeMembers(tx, circleId);
        perCircle.push([
          circleId,
          members.filter((member) => member.userId !== auth.userId).map((m) => m.userId),
        ]);
      }
      return perCircle;
    });
    for (const [circleId, others] of told) {
      this.events.emitLive(others, 'history', { circleId, userId: auth.userId });
    }
  }

  /** Deletes the caller's own trail in a circle ("Geçmişimi sil"). */
  async remove(auth: AuthContext, circleId: string): Promise<void> {
    await this.limit(auth);
    const others = await this.database.asUser(auth.userId, async (tx) => {
      await tx
        .delete(historyChunks)
        .where(and(eq(historyChunks.circleId, circleId), eq(historyChunks.userId, auth.userId)));
      const members = await this.activeMembers(tx, circleId);
      return members.filter((member) => member.userId !== auth.userId).map((m) => m.userId);
    });
    this.events.emitLive(others, 'history', { circleId, userId: auth.userId });
  }

  private async limit(auth: AuthContext, kind: 'puts' | 'lists' = 'puts'): Promise<void> {
    const { limit, windowSeconds } = HISTORY_LIMITS[kind];
    const hit = await this.limiter.hit(`history-${kind}:${auth.userId}`, limit, windowSeconds);
    if (!hit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', hit.retryAfter);
    }
  }

  /** Active members of a circle with its epoch; empty unless the caller is one (RLS). */
  private activeMembers(tx: Tx, circleId: string) {
    return tx
      .select({ userId: circleMembers.userId, epoch: circles.epoch })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, 'active')));
  }
}
