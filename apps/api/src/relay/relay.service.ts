import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { verifyMessageEnvelope } from '@bargu/crypto';
import type { MessageEnvelope, PublishReply } from '@bargu/schemas';
import { messageEnvelopeSchema, RELAY_REFUSALS } from '@bargu/schemas';
import { and, eq, inArray } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { circleMembers, circles } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

/** A location is kept 24 hours after it was sent, then it is gone (BARGU_PLAN §1: no history). */
export const LOCATION_TTL_SECONDS = 24 * 3600;
/** The protocol accepts the current epoch and the two before it (PROTOCOL §5). */
const ACCEPTED_EPOCHS = 2;

export const RELAY_LIMITS = {
  /** Per device and circle: live mode sends one a second; a little room for bursts. */
  publishes: { limit: 3, windowSeconds: 2 },
  /** "I am looking at this circle": renewed every minute while the map is open. */
  watches: { limit: 2, windowSeconds: 30 },
} as const;

/** Latest envelope per circle member: `loc:{circleId}` → field userId (one active device each). */
const locationKey = (circleId: string) => `loc:${circleId}`;

/**
 * Stores an envelope unless a newer one (later epoch, or same epoch and higher sequence) is
 * already there, so a late HTTP publish never overwrites a fresher WebSocket one. Each field
 * expires on its own (Redis 7.4+ HEXPIRE).
 */
const STORE_IF_NEWER = `
local current = redis.call('HGET', KEYS[1], ARGV[1])
if current then
  local stored = cjson.decode(current)
  local epoch = tonumber(ARGV[3])
  local seq = tonumber(ARGV[4])
  if stored.epoch > epoch or (stored.epoch == epoch and stored.seq >= seq) then
    return 0
  end
end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HEXPIRE', KEYS[1], ARGV[5], 'FIELDS', 1, ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[5])
return 1
`;

type Refusal = (typeof RELAY_REFUSALS)[number];

interface Membership {
  epoch: number;
  /** Active members other than the caller. */
  others: string[];
}

/**
 * The location relay (BARGU_PLAN §3.2, Faz 5). It only ever handles ciphertext: it checks that an
 * envelope is signed by the caller's device, that the caller is an active member and that the
 * epoch is still accepted, keeps the latest envelope per member for 24 hours, and pushes it to the
 * other members at once. It cannot read where anyone is.
 */
@Injectable()
export class RelayService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
  ) {}

  async publish(auth: AuthContext, envelopes: MessageEnvelope[]): Promise<PublishReply> {
    const memberships = await this.memberships(
      auth.userId,
      envelopes.map((envelope) => envelope.circleId),
    );
    const refused: { circleId: string; code: Refusal }[] = [];
    let accepted = 0;
    for (const envelope of envelopes) {
      const code = await this.check(auth, envelope, memberships.get(envelope.circleId));
      if (code !== null) {
        refused.push({ circleId: envelope.circleId, code });
        continue;
      }
      accepted += 1;
      const stored = await this.redis.eval(STORE_IF_NEWER, {
        keys: [locationKey(envelope.circleId)],
        arguments: [
          auth.userId,
          JSON.stringify(envelope),
          String(envelope.epoch),
          String(envelope.seq),
          String(LOCATION_TTL_SECONDS),
        ],
      });
      if (stored === 1) {
        this.events.emitLive(memberships.get(envelope.circleId)?.others ?? [], 'loc', {
          envelope,
        });
      }
    }
    return { accepted, refused };
  }

  /** The latest envelope of every other member, in every circle the caller is active in. */
  async snapshot(auth: AuthContext): Promise<MessageEnvelope[]> {
    const circleIds = await this.database.asUser(auth.userId, async (tx) =>
      (
        await tx
          .select({ id: circleMembers.circleId })
          .from(circleMembers)
          .where(and(eq(circleMembers.userId, auth.userId), eq(circleMembers.status, 'active')))
      ).map((row) => row.id),
    );
    const envelopes: MessageEnvelope[] = [];
    for (const circleId of circleIds) {
      const fields = await this.redis.hGetAll(locationKey(circleId));
      for (const [userId, raw] of Object.entries(fields)) {
        if (userId === auth.userId) continue;
        const parsed = messageEnvelopeSchema.safeParse(JSON.parse(raw));
        if (parsed.success) envelopes.push(parsed.data);
      }
    }
    return envelopes;
  }

  /** Stops showing the caller's last location in these circles (hidden, sharing turned off). */
  async withdraw(auth: AuthContext, circleIds: string[]): Promise<void> {
    const memberships = await this.memberships(auth.userId, circleIds);
    for (const [circleId, membership] of memberships) {
      await this.forget(circleId, auth.userId, membership.others);
    }
  }

  /** Someone looks at a circle on the map: its other members' phones switch to live updates. */
  async watch(auth: AuthContext, circleId: string): Promise<void> {
    const limit = await this.limiter.hit(
      `watch:${auth.userId}:${circleId}`,
      RELAY_LIMITS.watches.limit,
      RELAY_LIMITS.watches.windowSeconds,
    );
    if (!limit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', limit.retryAfter);
    }
    const membership = (await this.memberships(auth.userId, [circleId])).get(circleId);
    if (membership === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    this.events.emitLive(membership.others, 'watch', { circleId });
  }

  /** A member is no longer in a circle (left, removed) or stops sharing: their dot goes away. */
  async forget(circleId: string, userId: string, audience: Iterable<string>): Promise<void> {
    await this.redis.hDel(locationKey(circleId), userId);
    this.events.emitLive(audience, 'loc.gone', { circleId, userId });
  }

  /** A whole circle ended (a friendship): nothing of it is kept. */
  async forgetCircle(circleId: string): Promise<void> {
    await this.redis.del(locationKey(circleId));
  }

  /** Signed out or session revoked: the user's dot disappears from every circle. */
  async forgetEverywhere(userId: string): Promise<void> {
    const rows = await this.database.asUser(userId, (tx) =>
      tx
        .select({ id: circleMembers.circleId })
        .from(circleMembers)
        .where(and(eq(circleMembers.userId, userId), eq(circleMembers.status, 'active'))),
    );
    const memberships = await this.memberships(
      userId,
      rows.map((row) => row.id),
    );
    for (const [circleId, membership] of memberships) {
      await this.forget(circleId, userId, membership.others);
    }
  }

  private async check(
    auth: AuthContext,
    envelope: MessageEnvelope,
    membership: Membership | undefined,
  ): Promise<Refusal | null> {
    if (envelope.senderDeviceId !== auth.deviceId) return 'INVALID';
    if (!verifyMessageEnvelope(envelope, auth.identityKey)) return 'INVALID';
    if (membership === undefined) return 'NOT_MEMBER';
    if (envelope.epoch > membership.epoch || envelope.epoch < membership.epoch - ACCEPTED_EPOCHS) {
      return 'EPOCH';
    }
    const limit = await this.limiter.hit(
      `pub:${auth.deviceId}:${envelope.circleId}`,
      RELAY_LIMITS.publishes.limit,
      RELAY_LIMITS.publishes.windowSeconds,
    );
    return limit.allowed ? null : 'RATE_LIMITED';
  }

  /** For each circle the user is active in (among `circleIds`): its epoch and the other members. */
  private async memberships(userId: string, circleIds: string[]): Promise<Map<string, Membership>> {
    const unique = [...new Set(circleIds)];
    if (unique.length === 0) return new Map();
    const rows = await this.database.asUser(userId, (tx) =>
      tx
        .select({
          circleId: circleMembers.circleId,
          userId: circleMembers.userId,
          epoch: circles.epoch,
        })
        .from(circleMembers)
        .innerJoin(circles, eq(circles.id, circleMembers.circleId))
        .where(and(inArray(circleMembers.circleId, unique), eq(circleMembers.status, 'active'))),
    );
    const result = new Map<string, Membership>();
    for (const circleId of unique) {
      const members = rows.filter((row) => row.circleId === circleId);
      if (!members.some((row) => row.userId === userId)) continue;
      result.set(circleId, {
        epoch: members[0]?.epoch ?? 0,
        others: members.filter((row) => row.userId !== userId).map((row) => row.userId),
      });
    }
    return result;
  }
}
