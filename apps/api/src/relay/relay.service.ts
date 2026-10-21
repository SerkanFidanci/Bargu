import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { verifyMessageEnvelope } from '@bargu/crypto';
import type { BumpReply, DevicePushes, MessageEnvelope, PublishReply } from '@bargu/schemas';
import { messageEnvelopeSchema, RELAY_REFUSALS } from '@bargu/schemas';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { circleMembers, circles } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { currentDevices, Notifier } from '../push/notifier.js';
import { WatchNotices } from '../push/watch-notices.js';

/** A location is kept 24 hours after it was sent, then it is gone (BARGU_PLAN §1: no history). */
export const LOCATION_TTL_SECONDS = 24 * 3600;
/** The protocol accepts the current epoch and the two before it (PROTOCOL §5). */
const ACCEPTED_EPOCHS = 2;

export const RELAY_LIMITS = {
  /** Per device and circle: live mode sends one a second; a little room for bursts. */
  publishes: { limit: 3, windowSeconds: 2 },
  /** "I am looking at this circle": renewed every minute while the map is open. */
  watches: { limit: 2, windowSeconds: 30 },
  /** Pokes per sender and circle (BARGU_PLAN §4.3: 10 a minute per pair). */
  bumps: { limit: 10, windowSeconds: 60 },
  /** Status changes per device and circle: people set one now and then. */
  statuses: { limit: 6, windowSeconds: 60 },
  /** Arrivals and departures per device and circle (a phone notices them, debounced). */
  placeEvents: { limit: 20, windowSeconds: 600 },
} as const;

interface Limit {
  limit: number;
  windowSeconds: number;
}

/** Latest envelope per circle member: `loc:{circleId}` → field userId (one active device each). */
export const locationKey = (circleId: string) => `loc:${circleId}`;
/** Latest status per circle member, the same way (its own lifetime per field). */
const statusKey = (circleId: string) => `status:${circleId}`;
/** Latest profile message per member (the photo key, docs/ADR/0014). */
const profileKey = (circleId: string) => `profile:${circleId}`;
/** Latest look message per member (the chosen cosmetics and their pass, docs/ADR/0025). */
const lookKey = (circleId: string) => `look:${circleId}`;
/** Phones publish their profile again on every new epoch; this keeps it for quiet circles. */
export const PROFILE_TTL_SECONDS = 30 * 24 * 3600;

/** What the relay keeps per member: the location, and the status (emoji + text). */
const STORES = {
  loc: { key: locationKey, event: 'loc', gone: 'loc.gone', limit: RELAY_LIMITS.publishes },
  status: {
    key: statusKey,
    event: 'status',
    gone: 'status.gone',
    limit: RELAY_LIMITS.statuses,
  },
  profile: {
    key: profileKey,
    event: 'profile',
    gone: 'profile.gone',
    limit: RELAY_LIMITS.statuses,
  },
  // Goes wherever the profile goes, kept as long (docs/ADR/0025 §3).
  look: {
    key: lookKey,
    event: 'look',
    gone: 'look.gone',
    limit: RELAY_LIMITS.statuses,
  },
} as const;
type Store = keyof typeof STORES;

/**
 * Stores an envelope unless a newer one (later epoch, or same epoch and higher sequence) is
 * already there, so a late HTTP publish never overwrites a fresher WebSocket one. Each field
 * expires on its own (Redis 7.4+ HEXPIRE); the hash lives as long as its longest field.
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
if redis.call('TTL', KEYS[1]) < tonumber(ARGV[5]) then
  redis.call('EXPIRE', KEYS[1], ARGV[5])
end
return 1
`;

type Refusal = (typeof RELAY_REFUSALS)[number];

interface Membership {
  epoch: number;
  /** Active members other than the caller. */
  others: string[];
  /** Someone keeps it open (docs/ADR/0024); paused, its live location and arrivals wait. */
  open: boolean;
}

/**
 * The relay (BARGU_PLAN §3.2, Faz 5–6). It only ever handles ciphertext: it checks that an
 * envelope is signed by the caller's device, that the caller is an active member and that the
 * epoch is still accepted. Locations and statuses: the latest per member is kept for a limited
 * time and pushed to the other members at once. Pokes: forwarded live, never kept. It cannot read
 * where anyone is, what their status says, or that a message is a poke beyond which endpoint
 * carried it.
 */
@Injectable()
export class RelayService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(REDIS) private readonly redis: RedisClient,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
    private readonly notifier: Notifier,
    private readonly watchNotices: WatchNotices,
  ) {}

  publish(auth: AuthContext, envelopes: MessageEnvelope[]): Promise<PublishReply> {
    return this.store('loc', auth, envelopes, LOCATION_TTL_SECONDS);
  }

  publishStatus(
    auth: AuthContext,
    envelopes: MessageEnvelope[],
    ttlSeconds: number,
  ): Promise<PublishReply> {
    return this.store('status', auth, envelopes, ttlSeconds);
  }

  private async store(
    store: Store,
    auth: AuthContext,
    envelopes: MessageEnvelope[],
    ttlSeconds: number,
  ): Promise<PublishReply> {
    const { key, event, limit } = STORES[store];
    const memberships = await this.memberships(
      auth.userId,
      envelopes.map((envelope) => envelope.circleId),
    );
    const refused: { circleId: string; code: Refusal }[] = [];
    let accepted = 0;
    for (const envelope of envelopes) {
      const membership = memberships.get(envelope.circleId);
      const code =
        store === 'loc' && membership !== undefined && !membership.open
          ? 'PAUSED'
          : await this.check(auth, envelope, membership, `${store}:${auth.deviceId}`, limit);
      if (code !== null) {
        refused.push({ circleId: envelope.circleId, code });
        continue;
      }
      accepted += 1;
      const stored = await this.redis.eval(STORE_IF_NEWER, {
        keys: [key(envelope.circleId)],
        arguments: [
          auth.userId,
          JSON.stringify(envelope),
          String(envelope.epoch),
          String(envelope.seq),
          String(ttlSeconds),
        ],
      });
      if (stored === 1) this.events.emitLive(membership?.others ?? [], event, { envelope });
    }
    return { accepted, refused };
  }

  /** Profile messages (the photo key) to the caller's circles. */
  publishProfile(auth: AuthContext, envelopes: MessageEnvelope[]): Promise<PublishReply> {
    return this.store('profile', auth, envelopes, PROFILE_TTL_SECONDS);
  }

  /** The latest profile message of every other member, in every circle the caller is active in. */
  profiles(auth: AuthContext): Promise<MessageEnvelope[]> {
    return this.read('profile', auth);
  }

  /** Look messages (the chosen cosmetics, docs/ADR/0025) to the caller's circles. */
  publishLook(auth: AuthContext, envelopes: MessageEnvelope[]): Promise<PublishReply> {
    return this.store('look', auth, envelopes, PROFILE_TTL_SECONDS);
  }

  /** The latest look message of every other member, in every circle the caller is active in. */
  looks(auth: AuthContext): Promise<MessageEnvelope[]> {
    return this.read('look', auth);
  }

  /** The latest location of every other member, in every circle the caller is active in. */
  snapshot(auth: AuthContext): Promise<MessageEnvelope[]> {
    return this.read('loc', auth);
  }

  /** The current status of every other member, in every circle the caller is active in. */
  statuses(auth: AuthContext): Promise<MessageEnvelope[]> {
    return this.read('status', auth);
  }

  private async read(store: Store, auth: AuthContext): Promise<MessageEnvelope[]> {
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
      const fields = await this.redis.hGetAll(STORES[store].key(circleId));
      for (const [userId, raw] of Object.entries(fields)) {
        if (userId === auth.userId) continue;
        const parsed = messageEnvelopeSchema.safeParse(JSON.parse(raw));
        if (parsed.success) envelopes.push(parsed.data);
      }
    }
    return envelopes;
  }

  /** Stops showing the caller's last location in these circles (hidden, sharing turned off). */
  withdraw(auth: AuthContext, circleIds: string[]): Promise<void> {
    return this.take('loc', auth, circleIds);
  }

  /** Clears the caller's status in these circles. */
  withdrawStatus(auth: AuthContext, circleIds: string[]): Promise<void> {
    return this.take('status', auth, circleIds);
  }

  private async take(store: Store, auth: AuthContext, circleIds: string[]): Promise<void> {
    const memberships = await this.memberships(auth.userId, circleIds);
    for (const [circleId, membership] of memberships) {
      await this.remove(store, circleId, auth.userId, membership.others);
    }
  }

  /**
   * A poke: forwarded at once to the circle's other members who are online, kept nowhere. Those
   * whose app is closed get the sealed notification the sender's phone made for them.
   */
  bump(
    auth: AuthContext,
    envelope: MessageEnvelope,
    pushes: DevicePushes = [],
  ): Promise<BumpReply> {
    return this.forward(auth, envelope, pushes, 'bump', `bump:${auth.userId}`, RELAY_LIMITS.bumps);
  }

  /**
   * A member arrived at or left one of the circle's places (docs/ADR/0015): forwarded like a poke,
   * never stored. The server cannot tell which place, or whether it was an arrival.
   */
  placeEvent(
    auth: AuthContext,
    envelope: MessageEnvelope,
    pushes: DevicePushes,
  ): Promise<BumpReply> {
    return this.forward(
      auth,
      envelope,
      pushes,
      'place',
      `place:${auth.deviceId}`,
      RELAY_LIMITS.placeEvents,
    );
  }

  private async forward(
    auth: AuthContext,
    envelope: MessageEnvelope,
    pushes: DevicePushes,
    event: string,
    limitKey: string,
    limit: Limit,
  ): Promise<BumpReply> {
    const membership = (await this.memberships(auth.userId, [envelope.circleId])).get(
      envelope.circleId,
    );
    // A place arrival rests on the live location: it waits with it in a paused circle (ADR 0024).
    const code =
      event === 'place' && membership !== undefined && !membership.open
        ? 'PAUSED'
        : await this.check(auth, envelope, membership, limitKey, limit);
    if (code !== null || membership === undefined) return { refused: code ?? 'NOT_MEMBER' };
    this.events.emitLive(membership.others, event, { envelope });
    // Notifications only for members of this circle whose app is not connected, each to that
    // member's current device, once (QA 21 B-2).
    if (pushes.length > 0) {
      const online = await this.events.online(membership.others);
      const offline = membership.others.filter((userId) => !online.has(userId));
      const devices = await this.database.asUser(auth.userId, (tx) =>
        currentDevices(tx, envelope.circleId, offline),
      );
      await this.notifier.forward(pushes, devices);
    }
    return { ok: true };
  }

  /** Someone looks at a circle on the map: its other members' phones switch to live updates. */
  async watch(auth: AuthContext, circleId: string): Promise<void> {
    // Membership first: a stranger (or a deleted circle) leaves no counter behind (QA Faz 8 D1).
    const membership = (await this.memberships(auth.userId, [circleId])).get(circleId);
    if (membership === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    if (!membership.open) throw new ApiError(HttpStatus.FORBIDDEN, 'CIRCLE_PAUSED');
    const limit = await this.limiter.hit(
      `watch:${auth.userId}:${circleId}`,
      RELAY_LIMITS.watches.limit,
      RELAY_LIMITS.watches.windowSeconds,
    );
    if (!limit.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', limit.retryAfter);
    }
    this.events.emitLive(membership.others, 'watch', { circleId });
    // Members whose app is closed get a silent notice of the same (docs/ADR/0028 step 3): it names
    // the circle only, never the watcher, and each recipient has their own allowance.
    if (this.watchNotices.enabled) {
      const online = await this.events.online(membership.others);
      await this.watchNotices.tell(
        circleId,
        membership.others.filter((userId) => !online.has(userId)),
      );
    }
  }

  /** A member is no longer in a circle (left, removed): their dot and status go away. */
  async forget(circleId: string, userId: string, audience: Iterable<string>): Promise<void> {
    const others = [...audience];
    await this.remove('loc', circleId, userId, others);
    await this.remove('status', circleId, userId, others);
    await this.remove('profile', circleId, userId, others);
    await this.remove('look', circleId, userId, others);
  }

  private async remove(
    store: Store,
    circleId: string,
    userId: string,
    audience: string[],
  ): Promise<void> {
    await this.redis.hDel(STORES[store].key(circleId), userId);
    this.events.emitLive(audience, STORES[store].gone, { circleId, userId });
  }

  /** A whole circle ended (a friendship): nothing of it is kept. */
  async forgetCircle(circleId: string): Promise<void> {
    await this.redis.del([
      locationKey(circleId),
      statusKey(circleId),
      profileKey(circleId),
      lookKey(circleId),
    ]);
  }

  /** Signed out or session revoked: the user's dot and status disappear from every circle. */
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
    limitKey: string,
    limit: Limit,
  ): Promise<Refusal | null> {
    if (envelope.senderDeviceId !== auth.deviceId) return 'INVALID';
    if (!verifyMessageEnvelope(envelope, auth.identityKey)) return 'INVALID';
    if (membership === undefined) return 'NOT_MEMBER';
    if (envelope.epoch > membership.epoch || envelope.epoch < membership.epoch - ACCEPTED_EPOCHS) {
      return 'EPOCH';
    }
    const hit = await this.limiter.hit(
      `${limitKey}:${envelope.circleId}`,
      limit.limit,
      limit.windowSeconds,
    );
    return hit.allowed ? null : 'RATE_LIMITED';
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
        .where(
          and(
            inArray(circleMembers.circleId, unique),
            eq(circleMembers.status, 'active'),
            // An event that has ended takes nothing more, even before the sweep (QA Faz 8 D3).
            sql`(${circles.expiresAt} IS NULL OR ${circles.expiresAt} > now())`,
          ),
        ),
    );
    const openness = await this.database.asUser(userId, async (tx) => {
      const found = await tx
        .select({ id: circles.id, open: sql<boolean>`app.circle_is_open(${circles.id})` })
        .from(circles)
        .where(inArray(circles.id, unique));
      return new Map(found.map((row) => [row.id, row.open]));
    });
    const result = new Map<string, Membership>();
    for (const circleId of unique) {
      const members = rows.filter((row) => row.circleId === circleId);
      if (!members.some((row) => row.userId === userId)) continue;
      result.set(circleId, {
        epoch: members[0]?.epoch ?? 0,
        open: openness.get(circleId) ?? false,
        others: members.filter((row) => row.userId !== userId).map((row) => row.userId),
      });
    }
    return result;
  }
}
