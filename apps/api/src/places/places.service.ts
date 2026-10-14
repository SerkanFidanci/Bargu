import { HttpStatus, Injectable } from '@nestjs/common';
import { verifyMessageEnvelope } from '@bargu/crypto';
import {
  MAX_PLACES_PER_CIRCLE,
  messageEnvelopeSchema,
  type PlacePut,
  type PlaceRecord,
} from '@bargu/schemas';
import { and, count, eq, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { circleMembers, circles, places } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

/** Saves and deletes per user: editing a place is a handful of taps, re-sealing a few dozen. */
export const PLACE_LIMITS = { saves: { limit: 60, windowSeconds: 60 } } as const;

/**
 * A circle's places (BARGU_PLAN §4.3 "Yerler", docs/ADR/0015). Each is the signed, encrypted
 * `place` message of the member who last saved it, kept until deleted. The server checks the
 * signature (the caller's device), the membership (row-level security) and that the message uses
 * the circle's current epoch, so that every current member, new ones included, can open it. Saves
 * are compare-and-set on `version`; every change tells the other members `places.changed`.
 */
@Injectable()
export class PlacesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
  ) {}

  /** Every place of every circle the caller is active in (row-level security decides). */
  async list(auth: AuthContext): Promise<PlaceRecord[]> {
    const rows = await this.database.asUser(auth.userId, (tx) =>
      tx
        .select({
          id: places.id,
          circleId: places.circleId,
          version: places.version,
          envelope: places.envelope,
        })
        .from(places),
    );
    return rows.flatMap((row) => {
      const envelope = messageEnvelopeSchema.safeParse(row.envelope);
      return envelope.success ? [{ ...row, envelope: envelope.data }] : [];
    });
  }

  async put(
    auth: AuthContext,
    circleId: string,
    placeId: string,
    input: PlacePut,
  ): Promise<{ version: number }> {
    await this.limit(auth);
    const { envelope } = input;
    if (
      envelope.circleId !== circleId ||
      envelope.senderDeviceId !== auth.deviceId ||
      !verifyMessageEnvelope(envelope, auth.identityKey)
    ) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    const { version, others } = await this.database.asUser(auth.userId, async (tx) => {
      const members = await this.activeMembers(tx, circleId);
      const epoch = members.find((member) => member.userId === auth.userId)?.epoch;
      if (epoch === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      if (envelope.epoch !== epoch) throw new ApiError(HttpStatus.CONFLICT, 'EPOCH_STALE');
      // One save at a time per circle: the count below stays true until this one commits.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`places:${circleId}`}, 0))`,
      );
      let saved: { version: number }[];
      if (input.version === null) {
        const [{ total } = { total: 0 }] = await tx
          .select({ total: count() })
          .from(places)
          .where(eq(places.circleId, circleId));
        if (total >= MAX_PLACES_PER_CIRCLE) {
          throw new ApiError(HttpStatus.CONFLICT, 'PLACES_FULL');
        }
        saved = await tx
          .insert(places)
          .values({ id: placeId, circleId, envelope })
          .onConflictDoNothing()
          .returning({ version: places.version });
      } else {
        saved = await tx
          .update(places)
          .set({ envelope, version: sql`${places.version} + 1`, updatedAt: new Date() })
          .where(
            and(
              eq(places.id, placeId),
              eq(places.circleId, circleId),
              eq(places.version, input.version),
            ),
          )
          .returning({ version: places.version });
      }
      const [row] = saved;
      if (row === undefined) throw new ApiError(HttpStatus.CONFLICT, 'VERSION_CONFLICT');
      return {
        version: row.version,
        others: members.filter((member) => member.userId !== auth.userId).map((m) => m.userId),
      };
    });
    await this.events.publish(others, { type: 'places.changed', circleId });
    return { version };
  }

  async remove(auth: AuthContext, circleId: string, placeId: string): Promise<void> {
    await this.limit(auth);
    const others = await this.database.asUser(auth.userId, async (tx) => {
      const removed = await tx
        .delete(places)
        .where(and(eq(places.id, placeId), eq(places.circleId, circleId)))
        .returning({ id: places.id });
      if (removed.length === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const members = await this.activeMembers(tx, circleId);
      return members.filter((member) => member.userId !== auth.userId).map((m) => m.userId);
    });
    await this.events.publish(others, { type: 'places.changed', circleId });
  }

  private async limit(auth: AuthContext): Promise<void> {
    const hit = await this.limiter.hit(
      `places:${auth.userId}`,
      PLACE_LIMITS.saves.limit,
      PLACE_LIMITS.saves.windowSeconds,
    );
    if (!hit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', hit.retryAfter);
    }
  }

  /** Active members of a circle with its epoch; empty unless the caller is a member too (RLS). */
  private activeMembers(tx: Tx, circleId: string) {
    return tx
      .select({ userId: circleMembers.userId, epoch: circles.epoch })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, 'active')));
  }
}
