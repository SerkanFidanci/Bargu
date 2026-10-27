import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import {
  fromBase64url,
  openChatPhoto,
  openReportedItem,
  sealAtRest,
  toBase64url,
} from '@bargu/crypto';
import { type ChatPayload, REPORT_KEEP_DAYS, type ReportRequest } from '@bargu/schemas';
import { and, eq, sql } from 'drizzle-orm';

import { AuthKeys } from '../auth/auth-keys.js';
import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { mediaBlobs, reports } from '../db/schema.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { EmailJobs } from '../jobs/email-jobs.js';

/** What the content of a report is sealed for at rest (its own purpose, docs/ADR/0035 §9). */
export const REPORT_CONTENT_CONTEXT = 'report/content';
/** Reports per reporter per day: enough for anyone harassed, too few to flood the owner. */
const REPORTS_PER_DAY = 20;
const DAY_MS = 24 * 3600 * 1000;

/** What a verified report keeps of the item: what it said or showed, never a key. */
interface ReportedContent {
  kind: ChatPayload['kind'];
  circleId: string | null;
  text?: string;
  caption?: string;
  story?: boolean;
  /** The photo as JPEG, base64url, when its file was there and matched the item. */
  image?: string;
  sentAt: number;
}

/**
 * Reports (docs/ADR/0035 §9). The reporter's phone hands over one item and that item's own key and
 * nonce; the server checks the sender device's signature and the key commitment, decrypts, and
 * keeps what the item said, sealed at rest, for 90 days (child abuse: until the owner closes it).
 * A report that does not verify is kept as one, without content. The operator hears of it by email
 * (OPS_EMAIL), with the reason and an id only.
 */
@Injectable()
export class ReportsService {
  private readonly logger = new Logger('Reports');

  constructor(
    private readonly database: DatabaseService,
    private readonly limiter: RateLimiter,
    private readonly keys: AuthKeys,
    private readonly email: EmailJobs,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async report(auth: AuthContext, request: ReportRequest): Promise<void> {
    if (request.userId === auth.userId) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    const day = await this.limiter.hit(`reports:${auth.userId}`, REPORTS_PER_DAY, 24 * 3600);
    if (!day.allowed)
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', day.retryAfter);
    const id = await this.database.asUser(auth.userId, async (tx) => {
      const content = request.item === undefined ? null : await this.read(tx, request);
      const [row] = await tx
        .insert(reports)
        .values({
          reporterId: auth.userId,
          reportedId: request.userId,
          reason: request.reason,
          itemId: request.item?.envelope.id ?? null,
          verified: content !== null,
          content:
            content === null
              ? null
              : sealAtRest(
                  this.keys.jobPayloadKey,
                  new TextEncoder().encode(JSON.stringify(content)),
                  REPORT_CONTENT_CONTEXT,
                ),
          retainUntil:
            request.reason === 'child' ? null : new Date(Date.now() + REPORT_KEEP_DAYS * DAY_MS),
        })
        .returning({ id: reports.id });
      if (row === undefined) throw new ApiError(HttpStatus.INTERNAL_SERVER_ERROR, 'INTERNAL');
      return row.id;
    });
    await this.tell(id, request.reason);
  }

  /** The item as its sender sent it, or null when it does not verify as theirs. */
  private async read(tx: Tx, request: ReportRequest): Promise<ReportedContent | null> {
    const item = request.item;
    if (item === undefined) return null;
    const [device] = (
      await tx.execute<{ user_id: string; identity_key: Buffer }>(
        sql`SELECT user_id, identity_key FROM app.reported_device(${item.envelope.senderDeviceId})`,
      )
    ).rows;
    if (device?.user_id !== request.userId) return null;
    let payload: ChatPayload;
    try {
      payload = openReportedItem({
        envelope: item.envelope,
        key: item.key,
        nonce: item.nonce,
        senderIdentityKey: new Uint8Array(device.identity_key),
      });
    } catch {
      return null;
    }
    const content: ReportedContent = {
      kind: payload.kind,
      circleId: 'circleId' in item.envelope ? item.envelope.circleId : null,
      sentAt: payload.ts,
    };
    if (payload.kind === 'text') content.text = payload.text;
    if (payload.kind === 'photo') {
      if (payload.caption !== undefined) content.caption = payload.caption;
      content.story = payload.story;
      const image = await this.photoOf(tx, payload, request.file);
      if (image !== null) content.image = image;
    }
    return content;
  }

  /** The photo of a verified item: from the file handed over, or the one still kept here. */
  private async photoOf(
    tx: Tx,
    photo: Extract<ChatPayload, { kind: 'photo' }>,
    handed: string | undefined,
  ): Promise<string | null> {
    let sealed: Uint8Array | null = handed === undefined ? null : fromBase64url(handed);
    if (sealed === null) {
      const [kept] = await tx
        .select({ bytes: mediaBlobs.bytes })
        .from(mediaBlobs)
        .where(and(eq(mediaBlobs.id, photo.blobId), sql`${mediaBlobs.expiresAt} > now()`));
      sealed = kept?.bytes ?? null;
    }
    if (sealed === null) return null;
    try {
      return toBase64url(
        openChatPhoto({
          key: fromBase64url(photo.key),
          blobId: photo.blobId,
          hash: photo.hash,
          sealed,
        }),
      );
    } catch {
      return null;
    }
  }

  /** The operator hears of it: by email when OPS_EMAIL is set, otherwise in the log. */
  private async tell(id: string, reason: string): Promise<void> {
    if (this.env.OPS_EMAIL === undefined) {
      this.logger.warn(`new report: reason ${reason}, id ${id}`);
      return;
    }
    try {
      await this.email.enqueueOps({ to: this.env.OPS_EMAIL, topic: 'report', detail: reason, id });
    } catch (error) {
      // The report is kept all the same; the log still says it came.
      this.logger.warn(
        `new report: reason ${reason}, id ${id} (email not queued: ${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }
}
