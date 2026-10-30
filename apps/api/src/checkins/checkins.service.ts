import { Inject, Injectable } from '@nestjs/common';
import { verifyDirectEnvelope } from '@bargu/crypto';
import {
  CHECKIN,
  CHECKIN_LIMITS,
  type CheckinBox,
  type CheckinInbox,
  type CheckinList,
  type CheckinRefusal,
  type CheckinReply,
  CLIENT_LEVEL_FOR,
  directEnvelopeSchema,
} from '@bargu/schemas';
import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError, HTTP_UPGRADE_REQUIRED } from '../common/api-error.js';
import { checkinBoxes, checkins } from '../db/schema.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { QUEUES } from '../jobs/queues.js';
import { JOB_QUEUE } from '../jobs/tokens.js';

/** As Postgres reads an interval. */
const seconds = (ms: number) => `${String(Math.round(ms / 1000))} seconds`;

/**
 * Arrival checks, the sealed escrow (docs/ADR/0039 §5). The server keeps one sealed alert per
 * recipient's device, never reads them, and hands them over at their time unless the owner
 * cancelled first. The rules (how far ahead, how many, who may get one, the same people on every
 * refresh, only the owner moves the time) are migration 0045's functions. Each box must be signed
 * by the owner's device and sealed to its recipient's current device. Firing is the worker's
 * (checkin-worker.ts), from a job that carries the check's id and nothing else.
 */
@Injectable()
export class CheckinsService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
  ) {}

  /** Arrival checks need an app that knows them (CLIENT_LEVEL_FOR.checkins). */
  requireLevel(level: number): void {
    if (level < CLIENT_LEVEL_FOR.checkins) {
      throw new ApiError(HTTP_UPGRADE_REQUIRED, 'UPGRADE_REQUIRED');
    }
  }

  async create(
    auth: AuthContext,
    id: string,
    openAt: number,
    boxes: readonly CheckinBox[],
  ): Promise<CheckinReply> {
    if (!this.signed(auth, boxes)) return { refused: 'INVALID' };
    const result = await this.database.asUser(auth.userId, (tx) =>
      this.call(
        tx,
        sql`SELECT app.create_checkin(${id}::uuid, ${new Date(openAt).toISOString()}::timestamptz,
              ${seconds(CHECKIN.minAheadMs)}::interval, ${seconds(CHECKIN.maxAheadMs)}::interval,
              ${CHECKIN_LIMITS.maxActive}::integer, ${CHECKIN_LIMITS.perDay}::integer,
              ${CHECKIN.maxRecipients}::integer, ${JSON.stringify(boxes)}::jsonb) AS result`,
      ),
    );
    if (result !== 'ok') return { refused: result };
    await this.schedule(id, openAt);
    return { ok: true };
  }

  async refresh(
    auth: AuthContext,
    id: string,
    boxes: readonly CheckinBox[],
  ): Promise<CheckinReply> {
    if (!this.signed(auth, boxes)) return { refused: 'INVALID' };
    const result = await this.database.asUser(auth.userId, (tx) =>
      this.call(
        tx,
        sql`SELECT app.refresh_checkin(${id}::uuid, ${seconds(CHECKIN_LIMITS.refreshGapMs)}::interval,
              ${CHECKIN.maxRecipients}::integer, ${JSON.stringify(boxes)}::jsonb) AS result`,
      ),
    );
    return result === 'ok' ? { ok: true } : { refused: result };
  }

  async extend(
    auth: AuthContext,
    id: string,
    openAt: number,
    boxes: readonly CheckinBox[],
  ): Promise<CheckinReply> {
    if (!this.signed(auth, boxes)) return { refused: 'INVALID' };
    const result = await this.database.asUser(auth.userId, (tx) =>
      this.call(
        tx,
        sql`SELECT app.extend_checkin(${id}::uuid, ${new Date(openAt).toISOString()}::timestamptz,
              ${seconds(CHECKIN.maxAheadMs)}::interval, ${CHECKIN_LIMITS.maxExtends}::integer,
              ${CHECKIN.maxRecipients}::integer, ${JSON.stringify(boxes)}::jsonb) AS result`,
      ),
    );
    if (result !== 'ok') return { refused: result };
    await this.schedule(id, openAt);
    return { ok: true };
  }

  /** Arrived, or "İyiyim": gone for good if it has not fired; 'FIRED' if it has. */
  async cancel(auth: AuthContext, id: string): Promise<CheckinReply> {
    const result = await this.database.asUser(auth.userId, (tx) =>
      this.call(tx, sql`SELECT app.cancel_checkin(${id}::uuid) AS result`),
    );
    return result === 'ok' ? { ok: true } : { refused: result };
  }

  /** The owner's own checks (to cancel after a reinstall; to see which fired). */
  async list(auth: AuthContext): Promise<CheckinList> {
    return this.database.asUser(auth.userId, async (tx) => {
      const rows = await tx
        .select({ id: checkins.id, openAt: checkins.openAt, firedAt: checkins.firedAt })
        .from(checkins)
        .where(eq(checkins.ownerId, auth.userId))
        .orderBy(asc(checkins.openAt));
      // The owner cannot read the boxes (they are the recipients'); who they are, through a
      // function that tells the owner alone.
      const out: CheckinList['checkins'] = [];
      for (const row of rows) {
        const result = await tx.execute<{ recipient: string }>(
          sql`SELECT recipient FROM app.checkin_recipients(${row.id}::uuid) AS recipient`,
        );
        out.push({
          id: row.id,
          openAt: row.openAt.getTime(),
          firedAt: row.firedAt?.getTime() ?? null,
          recipients: result.rows.map((recipient) => recipient.recipient),
        });
      }
      return { checkins: out };
    });
  }

  /** Alerts handed over to the caller and not yet seen: their own box of each. */
  async inbox(auth: AuthContext): Promise<CheckinInbox> {
    return this.database.asUser(auth.userId, async (tx) => {
      const rows = await tx
        .select({
          checkinId: checkinBoxes.checkinId,
          box: checkinBoxes.box,
          ownerId: checkins.ownerId,
          firedAt: checkins.firedAt,
        })
        .from(checkinBoxes)
        .innerJoin(checkins, eq(checkins.id, checkinBoxes.checkinId))
        .where(and(eq(checkinBoxes.recipientId, auth.userId), isNotNull(checkins.firedAt)))
        .orderBy(asc(checkins.firedAt));
      return {
        alerts: rows.flatMap((row) => {
          const box = directEnvelopeSchema.safeParse(row.box);
          return box.success && row.firedAt !== null
            ? [
                {
                  checkinId: row.checkinId,
                  ownerId: row.ownerId,
                  firedAt: row.firedAt.getTime(),
                  box: box.data,
                },
              ]
            : [];
        }),
      };
    });
  }

  /** "Gördüm": the caller's box goes at once. */
  async ack(auth: AuthContext, id: string): Promise<void> {
    await this.database.asUser(auth.userId, (tx) =>
      tx.execute(sql`SELECT app.ack_checkin(${id}::uuid)`),
    );
  }

  /** Every box from this device, for its recipient's device. The server cannot check inside. */
  private signed(auth: AuthContext, boxes: readonly CheckinBox[]): boolean {
    return boxes.every(
      ({ box }) =>
        box.senderDeviceId === auth.deviceId && verifyDirectEnvelope(box, auth.identityKey),
    );
  }

  private async call(tx: Tx, query: ReturnType<typeof sql>): Promise<'ok' | CheckinRefusal> {
    const [row] = (await tx.execute<{ result: string }>(query)).rows;
    return (row?.result ?? 'INVALID') as 'ok' | CheckinRefusal;
  }

  /** The job that fires it at its time: the check's id, nothing else. */
  private async schedule(id: string, openAt: number): Promise<void> {
    await this.boss.send(
      QUEUES.checkinFire,
      { id },
      { startAfter: new Date(openAt), singletonKey: `${id}:${String(openAt)}` },
    );
  }
}
