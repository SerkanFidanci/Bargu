import { HttpStatus, Injectable } from '@nestjs/common';
import { verifyChatEnvelope } from '@bargu/crypto';
import {
  CLIENT_LEVEL_FOR,
  type ChatEnvelope,
  chatEnvelopeSchema,
  type DevicePushes,
  ROLLCALL,
  type Rollcall,
  type RollcallRefusal,
  type RollcallReply,
  type RollcallSetting,
} from '@bargu/schemas';
import { and, asc, desc, eq, gt, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError, HTTP_UPGRADE_REQUIRED } from '../common/api-error.js';
import { circleMembers, circles, rollcallAnswers, rollcalls, users } from '../db/schema.js';
import { isUniqueViolation } from '../devices/device-registry.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { currentDevices, Notifier } from '../push/notifier.js';

/** The protocol accepts the current epoch and the two before it (PROTOCOL §5), as messages do. */
const ACCEPTED_EPOCHS = 2;

/** How long one is open, as Postgres reads an interval. */
const OPEN = `${String(ROLLCALL.openMs / 1000)} seconds`;

/** What a step came to inside its transaction: refused, or the roll call and who hears of it. */
type Outcome = { refused: RollcallRefusal } | { rollcall: Rollcall; owners: string[] };

/**
 * Event roll calls, "Herkes yerinde mi?" (docs/ADR/0040). The server checks the sealed question and
 * answers (signed by the sender's device, the circle's current epoch) and the rules, inside the
 * database functions of migration 0044: an owner of an event that has not ended asks, one at a
 * time and six an hour, for ten minutes; only the members fixed as able to answer answer, once. It
 * tells the owners and those members live, with the whole roll call, and forwards the owner's
 * sealed notifications to those of them whose app is closed. An answer carries no location. A
 * roll call closes by its time (or an owner's "Bitir"): no job runs for it, the phones close it at
 * `closesAt` themselves.
 */
@Injectable()
export class RollcallsService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    private readonly notifier: Notifier,
  ) {}

  /** Roll calls need an app that knows them (CLIENT_LEVEL_FOR.rollcalls). */
  requireLevel(level: number): void {
    if (level < CLIENT_LEVEL_FOR.rollcalls) {
      throw new ApiError(HTTP_UPGRADE_REQUIRED, 'UPGRADE_REQUIRED');
    }
  }

  async start(
    auth: AuthContext,
    circleId: string,
    envelope: ChatEnvelope,
    pushes: DevicePushes = [],
  ): Promise<RollcallReply> {
    if (!this.signed(auth, circleId, envelope)) return { refused: 'INVALID' };
    let outcome: Outcome;
    try {
      outcome = await this.database.asUser(auth.userId, async (tx): Promise<Outcome> => {
        const refusal = await this.epochRefusal(tx, circleId, envelope);
        if (refusal !== null) return { refused: refusal };
        const result = await this.call(
          tx,
          sql`SELECT app.start_rollcall(${envelope.id}::uuid, ${circleId}::uuid, ${OPEN}::interval,
                ${ROLLCALL.perHour}::integer, ${ROLLCALL.teenMaxMembers}::integer,
                ${JSON.stringify(envelope)}::jsonb) AS result`,
        );
        return result === 'ok' ? this.outcomeOf(tx, envelope.id, circleId) : { refused: result };
      });
    } catch (error) {
      // A roll call with this id is there already, here or in a circle the caller cannot see: a
      // refusal like any other, not a server error (QA-44 Düşük 5).
      if (isUniqueViolation(error)) return { refused: 'INVALID' };
      throw error;
    }
    if ('refused' in outcome) return { refused: outcome.refused };
    const { rollcall, owners } = outcome;
    this.tell(rollcall, owners);
    // The owner's phone sealed a notification for members' devices: only those who may answer, and
    // whose app is closed, get theirs.
    const eligible = new Set(rollcall.eligible);
    const wanted = pushes.filter((push) => eligible.has(push.userId));
    if (wanted.length > 0) {
      const online = await this.events.online(eligible);
      const offline = rollcall.eligible.filter((userId) => !online.has(userId));
      const devices = await this.database.asUser(auth.userId, (tx) =>
        currentDevices(tx, circleId, offline),
      );
      await this.notifier.forward(wanted, devices);
    }
    return { ok: true, rollcall };
  }

  async answer(
    auth: AuthContext,
    circleId: string,
    rollcallId: string,
    envelope: ChatEnvelope,
  ): Promise<RollcallReply> {
    if (!this.signed(auth, circleId, envelope)) return { refused: 'INVALID' };
    const outcome = await this.database.asUser(auth.userId, async (tx): Promise<Outcome> => {
      const refusal = await this.epochRefusal(tx, circleId, envelope);
      if (refusal !== null) return { refused: refusal };
      if (!(await this.inCircle(tx, rollcallId, circleId))) return { refused: 'NOT_ELIGIBLE' };
      const result = await this.call(
        tx,
        sql`SELECT app.answer_rollcall(${rollcallId}::uuid, ${JSON.stringify(envelope)}::jsonb)
              AS result`,
      );
      return result === 'ok' ? this.outcomeOf(tx, rollcallId, circleId) : { refused: result };
    });
    if ('refused' in outcome) return { refused: outcome.refused };
    this.tell(outcome.rollcall, outcome.owners);
    return { ok: true, rollcall: outcome.rollcall };
  }

  /** "Bitir": an owner ends it now. */
  async close(auth: AuthContext, circleId: string, rollcallId: string): Promise<RollcallReply> {
    const outcome = await this.database.asUser(auth.userId, async (tx): Promise<Outcome> => {
      if (!(await this.inCircle(tx, rollcallId, circleId))) return { refused: 'NOT_OWNER' };
      const result = await this.call(
        tx,
        sql`SELECT app.close_rollcall(${rollcallId}::uuid) AS result`,
      );
      return result === 'ok' ? this.outcomeOf(tx, rollcallId, circleId) : { refused: result };
    });
    if ('refused' in outcome) return { refused: outcome.refused };
    this.tell(outcome.rollcall, outcome.owners);
    return { ok: true, rollcall: outcome.rollcall };
  }

  /** The circle's open or latest roll call the caller may see; null for none (or none of theirs). */
  async current(auth: AuthContext, circleId: string): Promise<Rollcall | null> {
    return this.database.asUser(auth.userId, async (tx) => {
      const [latest] = await tx
        .select({ id: rollcalls.id })
        .from(rollcalls)
        .where(
          and(
            eq(rollcalls.circleId, circleId),
            gt(rollcalls.startedAt, new Date(Date.now() - ROLLCALL.keepMs)),
          ),
        )
        .orderBy(desc(rollcalls.startedAt))
        .limit(1);
      return latest === undefined ? null : this.read(tx, latest.id);
    });
  }

  /** "Etkinlik yoklamaları" (docs/ADR/0040 §6). */
  setting(auth: AuthContext): Promise<RollcallSetting> {
    return this.database.asUser(auth.userId, async (tx) => {
      const [row] = await tx
        .select({ on: users.rollcalls })
        .from(users)
        .where(eq(users.id, auth.userId));
      if (row === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
      return { on: row.on };
    });
  }

  setSetting(auth: AuthContext, on: boolean): Promise<RollcallSetting> {
    return this.database.asUser(auth.userId, async (tx) => {
      await tx.update(users).set({ rollcalls: on }).where(eq(users.id, auth.userId));
      return { on };
    });
  }

  /** Signed by this device for this circle (the server checks nothing inside: it cannot). */
  private signed(auth: AuthContext, circleId: string, envelope: ChatEnvelope): boolean {
    return (
      envelope.circleId === circleId &&
      envelope.senderDeviceId === auth.deviceId &&
      verifyChatEnvelope(envelope, auth.identityKey)
    );
  }

  /** The circle's current epoch, or the two before it; a stranger reads no circle and is refused. */
  private async epochRefusal(
    tx: Tx,
    circleId: string,
    envelope: ChatEnvelope,
  ): Promise<RollcallRefusal | null> {
    const [circle] = await tx
      .select({ epoch: circles.epoch })
      .from(circles)
      .where(eq(circles.id, circleId));
    if (circle === undefined) return 'NOT_ELIGIBLE';
    if (envelope.epoch > circle.epoch || envelope.epoch < circle.epoch - ACCEPTED_EPOCHS) {
      return 'EPOCH';
    }
    return null;
  }

  /** Whether a roll call the caller can see belongs to this circle (the path names both). */
  private async inCircle(tx: Tx, rollcallId: string, circleId: string): Promise<boolean> {
    const [call] = await tx
      .select({ circleId: rollcalls.circleId })
      .from(rollcalls)
      .where(eq(rollcalls.id, rollcallId));
    return call?.circleId === circleId;
  }

  /** Runs one of migration 0044's functions: 'ok', or a refusal. */
  private async call(tx: Tx, query: ReturnType<typeof sql>): Promise<'ok' | RollcallRefusal> {
    const [row] = (await tx.execute<{ result: string }>(query)).rows;
    return (row?.result ?? 'INVALID') as 'ok' | RollcallRefusal;
  }

  private async outcomeOf(tx: Tx, rollcallId: string, circleId: string): Promise<Outcome> {
    const rollcall = await this.read(tx, rollcallId);
    if (rollcall === null) return { refused: 'INVALID' };
    const rows = await tx
      .select({ userId: circleMembers.userId })
      .from(circleMembers)
      .where(
        and(
          eq(circleMembers.circleId, circleId),
          eq(circleMembers.status, 'active'),
          eq(circleMembers.role, 'owner'),
        ),
      );
    return { rollcall, owners: rows.map((row) => row.userId) };
  }

  /** A roll call with its answers, as row-level security lets the caller read it. */
  private async read(tx: Tx, rollcallId: string): Promise<Rollcall | null> {
    const [call] = await tx.select().from(rollcalls).where(eq(rollcalls.id, rollcallId));
    if (call === undefined) return null;
    const answers = await tx
      .select()
      .from(rollcallAnswers)
      .where(eq(rollcallAnswers.rollcallId, rollcallId))
      .orderBy(asc(rollcallAnswers.answeredAt));
    return {
      id: call.id,
      circleId: call.circleId,
      startedBy: call.startedBy,
      startedAt: call.startedAt.getTime(),
      closesAt: call.closesAt.getTime(),
      closedAt: call.closedAt?.getTime() ?? null,
      eligible: call.eligible,
      outCount: call.outCount,
      envelope: chatEnvelopeSchema.parse(call.envelope),
      answers: answers.map((answer) => ({
        userId: answer.userId,
        at: answer.answeredAt.getTime(),
        envelope: chatEnvelopeSchema.parse(answer.envelope),
      })),
    };
  }

  /** The whole roll call, live, to the circle's owners and those who may answer it. */
  private tell(rollcall: Rollcall, owners: readonly string[]): void {
    this.events.emitLive([...owners, ...rollcall.eligible], 'rollcall', { rollcall });
  }
}
