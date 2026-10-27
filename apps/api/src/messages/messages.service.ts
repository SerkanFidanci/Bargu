import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  fromBase64url,
  toBase64url,
  verifyChatEnvelope,
  verifyDirectEnvelope,
} from '@bargu/crypto';
import {
  CHAT_LIST_MAX,
  type ChatEnvelope,
  type ChatRecord,
  type ChatRefusal,
  type ChatSendReply,
  chatEnvelopeSchema,
  CLIENT_LEVEL_FOR,
  COMMUNITY_RULES_VERSION,
  type DevicePushes,
  type DirectEnvelope,
  directEnvelopeSchema,
  type Media,
} from '@bargu/schemas';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError, HTTP_UPGRADE_REQUIRED } from '../common/api-error.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { isPgError, PG } from '../db/pg-errors.js';
import { blocks, chatItems, circleMembers, circles, consents, mediaBlobs } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { currentDevices, Notifier } from '../push/notifier.js';

/** The protocol accepts the current epoch and the two before it (PROTOCOL §5), as the relay does. */
const ACCEPTED_EPOCHS = 2;
const DAY_SECONDS = 24 * 3600;

/** docs/ADR/0035 §10. */
export const MESSAGE_LIMITS = {
  /** Items per sender and conversation (a circle or a person). */
  perMinute: { limit: 30, windowSeconds: 60 },
  /** Items and photos per person per day. */
  itemsPerDay: 500,
  photosPerDay: 50,
  /** Reads of the list and of files per person: a phone reads them when it comes back. */
  reads: { limit: 120, windowSeconds: 60 },
  blocks: { limit: 30, windowSeconds: 60 },
};

/** What a send came to inside its transaction: refused, quietly dropped, or stored for these. */
type Outcome =
  { refused: ChatRefusal } | { dropped: true } | { record: ChatRecord; audience: Audience };

interface Audience {
  /** Who else sees the item (and gets it live or as a notification). */
  others: string[];
  /** For a circle, to find its members' current devices; for a person, their device. */
  circleId: string | null;
  device: string | null;
}

/**
 * Messages and moments (docs/ADR/0035): items for a circle or for one person and their photo files,
 * all gone 24 hours after they were sent (the worker deletes them; reads never show older). The
 * server checks the sender's signature and that they may send there, stores the item for its
 * audience (row-level security decides who reads it), tells the audience live and forwards the
 * sealed notifications the sender's phone made for those whose app is closed. It never sees what
 * an item says or what a photo shows.
 */
@Injectable()
export class MessagesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
    private readonly notifier: Notifier,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Messages need an app that knows them (CLIENT_LEVEL_FOR.messages); older ones are told so. */
  requireLevel(level: number): void {
    if (level < CLIENT_LEVEL_FOR.messages) {
      throw new ApiError(HTTP_UPGRADE_REQUIRED, 'UPGRADE_REQUIRED');
    }
  }

  async toCircle(
    auth: AuthContext,
    circleId: string,
    envelope: ChatEnvelope,
    blobId: string | undefined,
    pushes: DevicePushes = [],
  ): Promise<ChatSendReply> {
    if (
      envelope.circleId !== circleId ||
      envelope.senderDeviceId !== auth.deviceId ||
      !verifyChatEnvelope(envelope, auth.identityKey)
    ) {
      return { refused: 'INVALID' };
    }
    const outcome = await this.database.asUser(auth.userId, async (tx): Promise<Outcome> => {
      await this.requireRules(tx, auth.userId);
      const members = await tx
        .select({
          userId: circleMembers.userId,
          epoch: circles.epoch,
          kind: circles.kind,
          expiresAt: circles.expiresAt,
        })
        .from(circleMembers)
        .innerJoin(circles, eq(circles.id, circleMembers.circleId))
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.status, 'active')));
      const circle = members[0];
      if (
        circle === undefined ||
        !members.some((member) => member.userId === auth.userId) ||
        // An event that has ended takes nothing more, even before the sweep (as the relay).
        (circle.expiresAt !== null && circle.expiresAt.getTime() <= Date.now())
      ) {
        return { refused: 'NOT_MEMBER' };
      }
      // A pair's conversation is the two people's own (docs/ADR/0035 §1): items for one person.
      if (circle.kind === 'pair') return { refused: 'INVALID' };
      if (envelope.epoch > circle.epoch || envelope.epoch < circle.epoch - ACCEPTED_EPOCHS) {
        return { refused: 'EPOCH' };
      }
      const refusal = await this.allowance(auth, `circle:${circleId}`);
      if (refusal !== null) return { refused: refusal };
      const stored = await this.store(tx, auth, envelope, { circleId, blobId });
      if (stored === null) return { refused: 'INVALID' };
      return {
        record: stored,
        audience: {
          others: members.filter((m) => m.userId !== auth.userId).map((m) => m.userId),
          circleId,
          device: null,
        },
      };
    });
    if ('refused' in outcome) return { refused: outcome.refused };
    if ('dropped' in outcome) return { ok: true };
    await this.deliver(auth, outcome.record, outcome.audience, pushes);
    return { ok: true };
  }

  async toPerson(
    auth: AuthContext,
    userId: string,
    envelope: DirectEnvelope,
    blobId: string | undefined,
    pushes: DevicePushes = [],
  ): Promise<ChatSendReply> {
    if (
      userId === auth.userId ||
      envelope.senderDeviceId !== auth.deviceId ||
      !verifyDirectEnvelope(envelope, auth.identityKey)
    ) {
      return { refused: 'INVALID' };
    }
    const outcome = await this.database.asUser(auth.userId, async (tx): Promise<Outcome> => {
      await this.requireRules(tx, auth.userId);
      const [found] = (
        await tx.execute<{ device: string | null; blocked: boolean }>(
          sql`SELECT app.direct_device_of(${userId}) AS device, app.blocked_by(${userId}) AS blocked`,
        )
      ).rows;
      const device = found?.device ?? null;
      // No circle shared (or no device): nobody to send to.
      if (device === null) return { refused: 'NOT_MEMBER' };
      // Sealed to a device the person no longer uses: the phone fetches their keys again.
      if (envelope.recipientDeviceId !== device) return { refused: 'EPOCH' };
      const refusal = await this.allowance(auth, `person:${userId}`);
      if (refusal !== null) return { refused: refusal };
      // Blocked: answered as if it went, so the sender does not learn of it; kept nowhere.
      if (found?.blocked === true) return { dropped: true };
      const stored = await this.store(tx, auth, envelope, { recipientId: userId, blobId });
      if (stored === null) return { refused: 'INVALID' };
      return {
        record: stored,
        audience: { others: [userId], circleId: null, device },
      };
    });
    if ('refused' in outcome) return { refused: outcome.refused };
    if ('dropped' in outcome) return { ok: true };
    await this.deliver(auth, outcome.record, outcome.audience, pushes);
    return { ok: true };
  }

  /** The caller's items after `after` (Unix ms), oldest first, never older than 24 hours. */
  async list(auth: AuthContext, after: number): Promise<ChatRecord[]> {
    await this.limit(auth, 'reads');
    const rows = await this.database.asUser(auth.userId, (tx) =>
      tx
        .select()
        .from(chatItems)
        .where(and(gt(chatItems.createdAt, new Date(after)), gt(chatItems.expiresAt, sql`now()`)))
        .orderBy(asc(chatItems.createdAt), asc(chatItems.id))
        .limit(CHAT_LIST_MAX),
    );
    return rows.flatMap((row) => {
      const record = recordOf(row);
      return record === null ? [] : [record];
    });
  }

  /** The sender takes an item back from everyone: gone from the server, and phones are told. */
  async remove(auth: AuthContext, itemId: string): Promise<void> {
    await this.limit(auth, 'reads');
    const audience = await this.database.asUser(auth.userId, async (tx) => {
      const [removed] = await tx
        .delete(chatItems)
        .where(and(eq(chatItems.id, itemId), eq(chatItems.senderId, auth.userId)))
        .returning({ circleId: chatItems.circleId, recipientId: chatItems.recipientId });
      if (removed === undefined) return null;
      if (removed.recipientId !== null) return [removed.recipientId];
      const members = await tx
        .select({ userId: circleMembers.userId })
        .from(circleMembers)
        .where(
          and(
            eq(circleMembers.circleId, removed.circleId ?? ''),
            eq(circleMembers.status, 'active'),
          ),
        );
      return members.map((member) => member.userId).filter((id) => id !== auth.userId);
    });
    if (audience === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    this.events.emitLive(audience, 'chat.gone', { id: itemId });
  }

  /**
   * A sealed photo, uploaded before the items that share it (docs/ADR/0035 §4). Counted against the
   * day's photos once, however many circles it then goes to; refused when the files of everyone
   * would pass MEDIA_MAX_BYTES.
   */
  async upload(auth: AuthContext, media: Media): Promise<void> {
    const bytes = fromBase64url(media.bytes);
    // Before the day's count: a refused photo does not use one of the 50.
    await this.database.asUser(auth.userId, (tx) => this.requireRules(tx, auth.userId));
    const day = await this.limiter.hit(
      `media-day:${auth.userId}`,
      MESSAGE_LIMITS.photosPerDay,
      DAY_SECONDS,
    );
    if (!day.allowed)
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', day.retryAfter);
    await this.database.asUser(auth.userId, async (tx) => {
      const [total] = (await tx.execute<{ bytes: string }>(sql`SELECT app.media_bytes() AS bytes`))
        .rows;
      if (Number(total?.bytes ?? 0) + bytes.length > this.env.MEDIA_MAX_BYTES) {
        throw new ApiError(HttpStatus.INSUFFICIENT_STORAGE, 'MEDIA_FULL');
      }
      const inserted = await tx
        .insert(mediaBlobs)
        .values({ id: media.id, ownerId: auth.userId, bytes })
        .onConflictDoNothing()
        .returning({ id: mediaBlobs.id });
      // The same upload again (no answer reached the phone) is fine; another person's id is not.
      if (inserted.length === 0) {
        const [own] = await tx
          .select({ id: mediaBlobs.id })
          .from(mediaBlobs)
          .where(and(eq(mediaBlobs.id, media.id), eq(mediaBlobs.ownerId, auth.userId)));
        if (own === undefined) throw new ApiError(HttpStatus.CONFLICT, 'VALIDATION_FAILED');
      }
    });
  }

  /** A file the caller may see (their own, or shared by an item they can read); else not found. */
  async download(auth: AuthContext, blobId: string): Promise<Media> {
    await this.limit(auth, 'reads');
    const [row] = await this.database.asUser(auth.userId, (tx) =>
      tx
        .select({ id: mediaBlobs.id, bytes: mediaBlobs.bytes })
        .from(mediaBlobs)
        .where(and(eq(mediaBlobs.id, blobId), gt(mediaBlobs.expiresAt, sql`now()`))),
    );
    if (row === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return { id: row.id, bytes: toBase64url(row.bytes) };
  }

  async blocked(auth: AuthContext): Promise<string[]> {
    await this.limit(auth, 'reads');
    const rows = await this.database.asUser(auth.userId, (tx) =>
      tx.select({ blockedId: blocks.blockedId }).from(blocks),
    );
    return rows.map((row) => row.blockedId);
  }

  /** Blocking hides items and stories; it never touches circles or locations (ADR 0035 §6). */
  async block(auth: AuthContext, userId: string): Promise<void> {
    if (userId === auth.userId) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    await this.limit(auth, 'blocks');
    await this.database.asUser(auth.userId, (tx) =>
      tx.insert(blocks).values({ blockerId: auth.userId, blockedId: userId }).onConflictDoNothing(),
    );
  }

  async unblock(auth: AuthContext, userId: string): Promise<void> {
    await this.limit(auth, 'blocks');
    await this.database.asUser(auth.userId, (tx) =>
      tx.delete(blocks).where(and(eq(blocks.blockerId, auth.userId), eq(blocks.blockedId, userId))),
    );
  }

  /** The per-minute and per-day allowance of a sender; null when the item may go. */
  /**
   * The community rules accepted, this version or later (K14): no message, photo or story before
   * that. The app shows the rules first; this is for an app that did not.
   */
  private async requireRules(tx: Tx, userId: string): Promise<void> {
    const [row] = await tx
      .select({ version: consents.version })
      .from(consents)
      .where(
        and(
          eq(consents.userId, userId),
          eq(consents.purpose, 'rules'),
          isNull(consents.withdrawnAt),
        ),
      );
    if (row === undefined || row.version < COMMUNITY_RULES_VERSION) {
      throw new ApiError(HttpStatus.FORBIDDEN, 'RULES_REQUIRED');
    }
  }

  private async allowance(auth: AuthContext, conversation: string): Promise<ChatRefusal | null> {
    const minute = await this.limiter.hit(
      `chat:${auth.userId}:${conversation}`,
      MESSAGE_LIMITS.perMinute.limit,
      MESSAGE_LIMITS.perMinute.windowSeconds,
    );
    if (!minute.allowed) return 'RATE_LIMITED';
    const day = await this.limiter.hit(
      `chat-day:${auth.userId}`,
      MESSAGE_LIMITS.itemsPerDay,
      DAY_SECONDS,
    );
    return day.allowed ? null : 'DAILY_LIMIT';
  }

  /**
   * Stores the item under row-level security (which checks the sender may send there and owns the
   * photo). The same item again (no answer reached the phone) is the stored one; an id someone
   * else used is refused.
   */
  private async store(
    tx: Tx,
    auth: AuthContext,
    envelope: ChatEnvelope | DirectEnvelope,
    to: { circleId?: string; recipientId?: string; blobId: string | undefined },
  ): Promise<ChatRecord | null> {
    if (to.blobId !== undefined) {
      // Only a photo the sender uploaded (row-level security says so too).
      const [own] = await tx
        .select({ id: mediaBlobs.id })
        .from(mediaBlobs)
        .where(and(eq(mediaBlobs.id, to.blobId), eq(mediaBlobs.ownerId, auth.userId)));
      if (own === undefined) return null;
    }
    let inserted: typeof chatItems.$inferSelect | undefined;
    try {
      [inserted] = await tx
        .insert(chatItems)
        .values({
          id: envelope.id,
          circleId: to.circleId ?? null,
          recipientId: to.recipientId ?? null,
          senderId: auth.userId,
          envelope,
          blobId: to.blobId ?? null,
        })
        .onConflictDoNothing()
        .returning();
    } catch (error) {
      // Refused by row-level security (checked above already; a race with leaving the circle).
      if (isPgError(error, PG.insufficientPrivilege)) return null;
      throw error;
    }
    if (inserted !== undefined) return recordOf(inserted);
    const [existing] = await tx
      .select()
      .from(chatItems)
      .where(and(eq(chatItems.id, envelope.id), eq(chatItems.senderId, auth.userId)));
    return existing === undefined ? null : recordOf(existing);
  }

  /**
   * To the audience: the item at once to those who are online, and the sealed notifications only
   * for the others, each to that person's current device, once.
   */
  private async deliver(
    auth: AuthContext,
    record: ChatRecord,
    audience: Audience,
    pushes: DevicePushes,
  ): Promise<void> {
    this.events.emitLive(audience.others, 'chat', { item: record });
    if (pushes.length === 0) return;
    const online = await this.events.online(audience.others);
    const offline = audience.others.filter((userId) => !online.has(userId));
    if (offline.length === 0) return;
    const devices =
      audience.circleId !== null
        ? await this.database.asUser(auth.userId, (tx) =>
            currentDevices(tx, audience.circleId ?? '', offline),
          )
        : new Map(
            audience.device === null
              ? []
              : offline.map((userId) => [userId, audience.device ?? '']),
          );
    await this.notifier.forward(pushes, devices);
  }

  private async limit(auth: AuthContext, kind: 'reads' | 'blocks'): Promise<void> {
    const { limit, windowSeconds } = MESSAGE_LIMITS[kind];
    const hit = await this.limiter.hit(`chat-${kind}:${auth.userId}`, limit, windowSeconds);
    if (!hit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', hit.retryAfter);
    }
  }
}

/** A stored row as phones get it; a row whose envelope no longer parses is left out. */
function recordOf(row: typeof chatItems.$inferSelect): ChatRecord | null {
  const envelope =
    row.circleId !== null
      ? chatEnvelopeSchema.safeParse(row.envelope)
      : directEnvelopeSchema.safeParse(row.envelope);
  if (!envelope.success) return null;
  return {
    id: row.id,
    senderId: row.senderId,
    circleId: row.circleId,
    recipientId: row.recipientId,
    envelope: envelope.data,
    blobId: row.blobId,
    at: row.createdAt.getTime(),
  };
}
