import { HttpStatus, Injectable } from '@nestjs/common';
import { verifyDocumentEnvelope, voteId } from '@bargu/crypto';
import {
  CLIENT_LEVEL_FOR,
  docEnvelopeSchema,
  type DocPut,
  type DocRecord,
  MAX_DOCS_PER_CIRCLE,
  MAX_POLLS_PER_MEMBER,
} from '@bargu/schemas';
import { and, count, eq, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { circleDocs, circleMembers, circles } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { currentDevices, Notifier } from '../push/notifier.js';

/** Saves and deletes per user: voting and planning are taps, re-sealing an event a few dozen. */
export const DOC_LIMITS = {
  saves: { limit: 120, windowSeconds: 60 },
  /** Notices of a meeting started outside an event, per member (docs/ADR/0026 §6). */
  meetingNotices: { limit: 6, windowSeconds: 3600 },
} as const;
/** How far ahead a meeting outside an event may end (migration 0032 says the same). */
export const MEETING_MAX_AHEAD_MS = 8 * 24 * 3600_000;

/**
 * Documents of event circles (docs/ADR/0018, 0020): the meeting, polls and votes. Each is the
 * signed, encrypted document of the member who last saved it. The server checks the signature (the
 * caller's device), the membership, where each kind is filed (the meeting under the event's id, a
 * vote under its voter's id for a poll of the event), who may change what (row-level security: the
 * meeting and polls the event's admins, a vote its author), how many polls a
 * member starts, that the circle is an event and that the document uses its current epoch, so that
 * every current member, new ones included, can open it. Saves are compare-and-set on `version`;
 * every change tells the other members `docs.changed`.
 */
@Injectable()
export class DocsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
    private readonly notifier: Notifier,
  ) {}

  /**
   * A circle's documents; empty unless the caller is an active member (row-level security). A
   * meeting outside an event only to apps of level 3 and newer (docs/ADR/0026 §7): older ones read
   * an event's documents only.
   */
  async list(auth: AuthContext, circleId: string, clientLevel: number): Promise<DocRecord[]> {
    const rows = await this.database.asUser(auth.userId, async (tx) => {
      if (clientLevel < CLIENT_LEVEL_FOR.circleMeetings) {
        const [circle] = await tx
          .select({ expiresAt: circles.expiresAt })
          .from(circles)
          .where(eq(circles.id, circleId));
        if (circle?.expiresAt === null) return [];
      }
      return tx
        .select({
          circleId: circleDocs.circleId,
          id: circleDocs.id,
          version: circleDocs.version,
          shared: circleDocs.shared,
          envelope: circleDocs.envelope,
        })
        .from(circleDocs)
        .where(eq(circleDocs.circleId, circleId));
    });
    return rows.flatMap((row) => {
      const envelope = docEnvelopeSchema.safeParse(row.envelope);
      return envelope.success ? [{ ...row, envelope: envelope.data }] : [];
    });
  }

  async put(
    auth: AuthContext,
    circleId: string,
    docId: string,
    input: DocPut,
  ): Promise<{ version: number }> {
    await this.limit(auth);
    const { envelope, kind, pollId, endsAt, pushes } = input;
    if (
      envelope.circleId !== circleId ||
      envelope.senderDeviceId !== auth.deviceId ||
      !verifyDocumentEnvelope(envelope, auth.identityKey) ||
      !filed(circleId, docId, input, auth.userId)
    ) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    const shared = kind !== 'vote';
    const { version, others, started } = await this.database.asUser(auth.userId, async (tx) => {
      const members = await this.activeMembers(tx, circleId);
      const me = members.find((member) => member.userId === auth.userId);
      if (me === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const event = me.expiresAt !== null;
      if (me.expiresAt !== null) {
        // Ended, the sweep about to delete it: nothing more is written (QA Faz 8 D3).
        if (me.expiresAt.getTime() <= Date.now()) {
          throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
        }
        // An event's documents go with the event: they name no end and notify nobody themselves.
        if (endsAt !== undefined || pushes !== undefined) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
        }
      } else {
        // Outside an event only the meeting (docs/ADR/0026), and it says when it goes.
        if (kind !== 'plan') throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
        if (
          endsAt === undefined ||
          endsAt <= Date.now() ||
          endsAt > Date.now() + MEETING_MAX_AHEAD_MS
        ) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
        }
      }
      if (envelope.epoch !== me.epoch) throw new ApiError(HttpStatus.CONFLICT, 'EPOCH_STALE');
      // An event's meeting and polls are the admins' (row-level security holds the same rule);
      // said so, rather than the "someone was faster" a refused compare-and-set would say.
      if (event && kind !== 'vote' && me.role !== 'owner') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      }
      // One save at a time per circle: the count below stays true until this one commits.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`docs:${circleId}`}, 0))`,
      );
      const meetingEnd = event || endsAt === undefined ? null : new Date(endsAt);
      let saved: { version: number }[];
      if (input.version === null) {
        const [{ total } = { total: 0 }] = await tx
          .select({ total: count() })
          .from(circleDocs)
          .where(eq(circleDocs.circleId, circleId));
        // One meeting at a time outside an event: the others see it, and start none.
        if (!event && total > 0) throw new ApiError(HttpStatus.CONFLICT, 'MEETING_EXISTS');
        if (total >= MAX_DOCS_PER_CIRCLE) throw new ApiError(HttpStatus.CONFLICT, 'DOCS_FULL');
        if (
          kind === 'poll' &&
          (await this.pollsBy(tx, circleId, auth.userId)) >= MAX_POLLS_PER_MEMBER
        ) {
          throw new ApiError(HttpStatus.CONFLICT, 'DOCS_FULL');
        }
        // A vote only in a poll of this event (row-level security says so too).
        if (pollId !== null && !(await this.isPoll(tx, circleId, pollId))) {
          throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
        }
        saved = await tx
          .insert(circleDocs)
          .values({
            circleId,
            id: docId,
            authorId: auth.userId,
            shared,
            kind,
            pollId,
            envelope,
            endsAt: meetingEnd,
          })
          .onConflictDoNothing()
          .returning({ version: circleDocs.version });
      } else {
        // Outside an event only its starter and the circle's admins change the meeting, either
        // one in a friendship (and row-level security); said so, rather than "someone was faster".
        if (!event && !(await this.mayRun(tx, circleId, auth.userId, me))) {
          throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
        }
        // Row-level security leaves out others' own documents (votes): those are a conflict too.
        saved = await tx
          .update(circleDocs)
          .set({
            envelope,
            version: sql`${circleDocs.version} + 1`,
            updatedAt: new Date(),
            ...(event ? {} : { endsAt: meetingEnd }),
          })
          .where(
            and(
              eq(circleDocs.circleId, circleId),
              eq(circleDocs.id, docId),
              eq(circleDocs.kind, kind),
              eq(circleDocs.version, input.version),
            ),
          )
          .returning({ version: circleDocs.version });
      }
      const [row] = saved;
      if (row === undefined) throw new ApiError(HttpStatus.CONFLICT, 'VERSION_CONFLICT');
      return {
        version: row.version,
        others: members.filter((member) => member.userId !== auth.userId).map((m) => m.userId),
        started: !event && input.version === null,
      };
    });
    await this.events.publish(others, { type: 'docs.changed', circleId });
    if (started && pushes !== undefined) await this.tellStarted(auth, circleId, others, pushes);
    return { version };
  }

  async remove(auth: AuthContext, circleId: string, docId: string): Promise<void> {
    await this.limit(auth);
    const others = await this.database.asUser(auth.userId, async (tx) => {
      const members = await this.activeMembers(tx, circleId);
      const me = members.find((member) => member.userId === auth.userId);
      // Outside an event only its starter and the circle's admins end the meeting, either one in a
      // friendship (and RLS).
      if (me?.expiresAt === null && !(await this.mayRun(tx, circleId, auth.userId, me))) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      }
      const removed = await tx
        .delete(circleDocs)
        .where(and(eq(circleDocs.circleId, circleId), eq(circleDocs.id, docId)))
        .returning({ id: circleDocs.id });
      if (removed.length === 0) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return members.filter((member) => member.userId !== auth.userId).map((m) => m.userId);
    });
    await this.events.publish(others, { type: 'docs.changed', circleId });
  }

  /**
   * Whether the caller runs the circle's meeting outside an event: its starter or an admin; in a
   * friendship either one, the two are equal (docs/ADR/0026 §1, the PM).
   */
  private async mayRun(
    tx: Tx,
    circleId: string,
    userId: string,
    me: { role: string; kind: string },
  ): Promise<boolean> {
    if (me.role === 'owner' || me.kind === 'pair') return true;
    const [row] = await tx
      .select({ authorId: circleDocs.authorId })
      .from(circleDocs)
      .where(and(eq(circleDocs.circleId, circleId), eq(circleDocs.id, circleId)));
    return row?.authorId === userId;
  }

  /**
   * A meeting just started outside an event (docs/ADR/0026 §6): the starter's sealed notices go to
   * the members whose app is not connected (the others see it come), each to that member's
   * current device, once (QA 21 B-2); a few an hour at most.
   */
  private async tellStarted(
    auth: AuthContext,
    circleId: string,
    others: readonly string[],
    pushes: NonNullable<DocPut['pushes']>,
  ): Promise<void> {
    if (pushes.length === 0) return;
    const { limit, windowSeconds } = DOC_LIMITS.meetingNotices;
    const hit = await this.limiter.hit(`meeting-notice:${auth.userId}`, limit, windowSeconds);
    if (!hit.allowed) return;
    const online = await this.events.online(others);
    const offline = others.filter((userId) => !online.has(userId));
    const devices = await this.database.asUser(auth.userId, (tx) =>
      currentDevices(tx, circleId, offline),
    );
    await this.notifier.forward(pushes, devices);
  }

  private async limit(auth: AuthContext): Promise<void> {
    const hit = await this.limiter.hit(
      `docs:${auth.userId}`,
      DOC_LIMITS.saves.limit,
      DOC_LIMITS.saves.windowSeconds,
    );
    if (!hit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', hit.retryAfter);
    }
  }

  private async pollsBy(tx: Tx, circleId: string, userId: string): Promise<number> {
    const [{ total } = { total: 0 }] = await tx
      .select({ total: count() })
      .from(circleDocs)
      .where(
        and(
          eq(circleDocs.circleId, circleId),
          eq(circleDocs.authorId, userId),
          eq(circleDocs.kind, 'poll'),
        ),
      );
    return total;
  }

  private async isPoll(tx: Tx, circleId: string, docId: string): Promise<boolean> {
    const [row] = await tx
      .select({ kind: circleDocs.kind })
      .from(circleDocs)
      .where(and(eq(circleDocs.circleId, circleId), eq(circleDocs.id, docId)));
    return row?.kind === 'poll';
  }

  /** Active members of a circle with its epoch and end; empty unless the caller is one (RLS). */
  private activeMembers(tx: Tx, circleId: string) {
    return tx
      .select({
        userId: circleMembers.userId,
        role: circleMembers.role,
        kind: circles.kind,
        epoch: circles.epoch,
        expiresAt: circles.expiresAt,
      })
      .from(circleMembers)
      .innerJoin(circles, eq(circles.id, circleMembers.circleId))
      .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, 'active')));
  }
}

/**
 * Where each kind is filed: the meeting under the event's id, a poll anywhere else, a vote under
 * its voter's id for its poll (one vote per member and poll; nobody votes for someone else).
 */
function filed(circleId: string, docId: string, input: DocPut, userId: string): boolean {
  if (input.kind === 'plan') return docId === circleId;
  if (input.kind === 'poll') return docId !== circleId;
  return input.pollId !== null && docId === voteId(input.pollId, userId);
}
