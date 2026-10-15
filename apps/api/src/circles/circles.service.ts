import { HttpStatus, Injectable, type OnModuleInit } from '@nestjs/common';
import { REKEY_INTERVAL_MS } from '@bargu/crypto';
import {
  AVATAR_EMOJIS,
  type Circle,
  type CircleCreate,
  EVENT_DURATION_MS,
  type MemberCard,
} from '@bargu/schemas';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { circleMembers, circles, invites } from '../db/schema.js';
import { DeviceLifecycle } from '../devices/device-lifecycle.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { Notifier } from '../push/notifier.js';
import { RelayService } from '../relay/relay.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

const HOUR = 3600;

/**
 * Per-account budgets: inviting people and requesting friends (no spam), asking for a new epoch.
 * Per circle: people coming in, each of whom starts a new epoch for everyone (QA Faz 8 O6); a full
 * event of 50 fits twice. Leaving and removing are never limited.
 */
export const CIRCLE_LIMITS = {
  invitationsPerHour: 30,
  rekeysPerHour: 30,
  joinsPerCirclePerHour: 100,
} as const;

/** Row of app.circle_member_cards (migrations/0003). */
interface CardRow extends Record<string, unknown> {
  user_id: string;
  role: 'owner' | 'member';
  status: 'invited' | 'active';
  username: string | null;
  display_name: string | null;
  avatar_color: number | null;
  avatar_emoji: string | null;
  device_id: string | null;
  platform: 'ios' | 'android' | null;
  identity_key: Buffer | null;
  dh_key: Buffer | null;
  dh_key_signature: Buffer | null;
}

const emojis: ReadonlySet<string> = new Set(AVATAR_EMOJIS);
const b64 = (bytes: Buffer) => bytes.toString('base64url');

function card(row: CardRow): MemberCard {
  const device =
    row.device_id !== null &&
    row.platform !== null &&
    row.identity_key !== null &&
    row.dh_key !== null &&
    row.dh_key_signature !== null
      ? {
          platform: row.platform,
          bundle: {
            deviceId: row.device_id,
            identityKey: b64(row.identity_key),
            dhKey: b64(row.dh_key),
            dhKeySignature: b64(row.dh_key_signature),
          },
        }
      : null;
  return {
    userId: row.user_id,
    role: row.role,
    status: row.status,
    username: row.username,
    displayName: row.display_name,
    avatar:
      row.avatar_color === null
        ? null
        : {
            color: row.avatar_color,
            emoji:
              row.avatar_emoji !== null && emojis.has(row.avatar_emoji) ? row.avatar_emoji : null,
          },
    device,
  };
}

/** Active members other than `me`: who hears that someone joined or accepted. */
export const othersActive = (circle: Circle, me: string) =>
  circle.members
    .filter((member) => member.userId !== me && member.status === 'active')
    .map((member) => member.userId);

/** Who to tell after a change: everyone still in (or invited to) the circle. */
const audience = (circle: Circle) => circle.members.map((member) => member.userId);

/**
 * Circles and membership (BARGU_PLAN §3.2, Faz 4). Every membership change starts a new key epoch
 * (PROTOCOL §4: added or removed members, device changes), and everyone affected hears about it as
 * an event once the change is committed. Row-level security limits every query to circles the
 * caller is in; cross-user steps go through the SECURITY DEFINER functions of migration 0003.
 */
@Injectable()
export class CirclesService implements OnModuleInit {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
    private readonly lifecycle: DeviceLifecycle,
    private readonly notifier: Notifier,
    private readonly relay: RelayService,
  ) {}

  onModuleInit(): void {
    this.lifecycle.subscribe(async (change) => {
      if (change.replacedDeviceId !== null) this.events.disconnectDevice(change.replacedDeviceId);
      if (change.kind !== 'login') {
        this.events.disconnectDevice(change.deviceId);
        // Signed out (or revoked): their dot leaves every map at once.
        await this.relay.forgetEverywhere(change.userId);
      }
      // New keys (a new phone), or keys that may be exposed (signed out, session revoked): every
      // circle of the user moves to a new epoch. A re-login of the same device changes nothing.
      if (change.kind !== 'login' || change.newDevice) {
        await this.startEpochsForDevice(change.userId);
      }
    });
  }

  async list(auth: Pick<AuthContext, 'userId'>): Promise<Circle[]> {
    return this.database.asUser(auth.userId, async (tx) => {
      const rows = await tx
        .select({ id: circleMembers.circleId })
        .from(circleMembers)
        .where(
          and(
            eq(circleMembers.userId, auth.userId),
            inArray(circleMembers.status, ['invited', 'active']),
          ),
        );
      const found = await Promise.all(rows.map((row) => this.read(tx, row.id, auth.userId)));
      return found.filter((circle): circle is Circle => circle !== null);
    });
  }

  async get(auth: Pick<AuthContext, 'userId'>, circleId: string): Promise<Circle> {
    const circle = await this.database.asUser(auth.userId, (tx) =>
      this.read(tx, circleId, auth.userId),
    );
    if (circle === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return circle;
  }

  async create(auth: AuthContext, input: CircleCreate, now = Date.now()): Promise<Circle> {
    // An event ends between a quarter of an hour and a week from now (docs/ADR/0017).
    const expiresAt =
      input.kind === 'event'
        ? new Date(
            Math.min(
              Math.max(input.endsAt, now + EVENT_DURATION_MS.min),
              now + EVENT_DURATION_MS.max,
            ),
          )
        : null;
    if (input.kind === 'event' && expiresAt?.getTime() !== input.endsAt) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    }
    return this.database.asUser(auth.userId, async (tx) => {
      const [created] = await tx
        .insert(circles)
        .values({ kind: input.kind, name: input.name, createdBy: auth.userId, expiresAt })
        .returning({ id: circles.id });
      if (created === undefined) throw new Error('circle insert returned nothing');
      await tx.insert(circleMembers).values({
        circleId: created.id,
        userId: auth.userId,
        role: 'owner',
        status: 'active',
        joinedAt: new Date(),
      });
      return this.mustRead(tx, created.id, auth.userId);
    });
  }

  async rename(auth: AuthContext, circleId: string, name: string): Promise<Circle> {
    const circle = await this.database.asUser(auth.userId, async (tx) => {
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (before.kind === 'pair' || before.myRole !== 'owner' || before.myStatus !== 'active') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      }
      await tx.update(circles).set({ name }).where(eq(circles.id, circleId));
      return this.mustRead(tx, circleId, auth.userId);
    });
    await this.changed(circle);
    return circle;
  }

  /**
   * Joins a circle one was invited to: the circle moves to a new epoch for its new member. Asked
   * again once in (a retried request), it answers with the circle and changes nothing (QA Faz 9 B2).
   */
  async accept(auth: AuthContext, circleId: string): Promise<Circle> {
    const { circle, fresh } = await this.database.asUser(auth.userId, async (tx) => {
      await this.lock(tx, circleId);
      const updated = await tx
        .update(circleMembers)
        .set({ status: 'active', joinedAt: new Date() })
        .where(
          and(
            eq(circleMembers.circleId, circleId),
            eq(circleMembers.userId, auth.userId),
            eq(circleMembers.status, 'invited'),
          ),
        )
        .returning({ circleId: circleMembers.circleId });
      if (updated.length === 0) {
        const current = await this.read(tx, circleId, auth.userId);
        if (current?.myStatus === 'active') return { circle: current, fresh: false };
        throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      }
      await this.limitJoins(circleId);
      await this.startEpoch(tx, circleId);
      return { circle: await this.mustRead(tx, circleId, auth.userId), fresh: true };
    });
    if (!fresh) return circle;
    await this.changed(circle);
    await this.notifier.notify(
      othersActive(circle, auth.userId),
      circle.kind === 'pair' ? 'friendAccepted' : 'memberJoined',
      circle.id,
    );
    return circle;
  }

  async decline(auth: Pick<AuthContext, 'userId'>, circleId: string): Promise<void> {
    const remaining = await this.database.asUser(auth.userId, async (tx) => {
      await this.lock(tx, circleId);
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (before.myStatus !== 'invited') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      await tx
        .update(circleMembers)
        .set({ status: 'declined', endedAt: new Date() })
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, auth.userId)));
      // A declined friend request is over for the one who asked, too.
      if (before.kind === 'pair') await tx.execute(sql`SELECT app.end_pair(${circleId})`);
      return audience(before).filter((userId) => userId !== auth.userId);
    });
    await this.events.publish([auth.userId], { type: 'circle.gone', circleId });
    await this.notifyById(remaining, circleId, auth.userId);
  }

  /**
   * Leaves a circle (for a pair: ends the friendship, for both). An owner leaving a group hands
   * ownership on first (see handOver), so a group is never left without one.
   */
  async leave(auth: Pick<AuthContext, 'userId'>, circleId: string): Promise<void> {
    const { remaining, pair, withdrawn } = await this.database.asUser(auth.userId, async (tx) => {
      await this.lock(tx, circleId);
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (before.myStatus !== 'active') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const withdrawnIds =
        before.kind !== 'pair' && before.myRole === 'owner'
          ? await this.handOver(tx, circleId, auth.userId)
          : [];
      // New epoch first (while still a member), so the one leaving never gets its keys.
      await this.startEpoch(tx, circleId);
      await tx
        .update(circleMembers)
        .set({ status: 'left', endedAt: new Date() })
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, auth.userId)));
      if (before.kind === 'pair') await tx.execute(sql`SELECT app.end_pair(${circleId})`);
      return {
        remaining: before.members
          .map((member) => member.userId)
          .filter((userId) => userId !== auth.userId && !withdrawnIds.includes(userId)),
        pair: before.kind === 'pair',
        withdrawn: withdrawnIds,
      };
    });
    await this.events.publish([auth.userId, ...withdrawn], { type: 'circle.gone', circleId });
    // Whoever leaves takes their last location with them.
    if (pair) await this.relay.forgetCircle(circleId);
    else await this.relay.forget(circleId, auth.userId, remaining);
    if (pair) {
      // A friendship needs both people: it disappears for the other side too.
      await this.events.publish(remaining, { type: 'circle.gone', circleId });
      return;
    }
    await this.notifyById(remaining, circleId, auth.userId);
  }

  /** An owner removes a member (or withdraws an invitation); the rest move to a new epoch. */
  async remove(auth: AuthContext, circleId: string, userId: string): Promise<Circle> {
    if (userId === auth.userId) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    const circle = await this.database.asUser(auth.userId, async (tx) => {
      await this.lock(tx, circleId);
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (before.kind === 'pair' || before.myRole !== 'owner' || before.myStatus !== 'active') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      }
      const target = before.members.find((member) => member.userId === userId);
      if (target === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      if (target.role === 'owner') throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      await this.startEpoch(tx, circleId);
      await tx
        .update(circleMembers)
        .set({ status: 'removed', endedAt: new Date() })
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
      return this.mustRead(tx, circleId, auth.userId);
    });
    await this.events.publish([userId], { type: 'circle.gone', circleId });
    await this.relay.forget(circleId, userId, audience(circle));
    await this.changed(circle);
    return circle;
  }

  /**
   * An admin makes a member admin, or takes it back from another admin (docs/ADR/0020): not from
   * themselves, not from whoever created the circle, never in a pair. Keys do not change (no new
   * epoch); the members hear `circle.changed`. Who is no longer an admin of an event loses the QR
   * codes they made: only admins let people into an event.
   */
  async setRole(
    auth: AuthContext,
    circleId: string,
    userId: string,
    role: 'owner' | 'member',
  ): Promise<Circle> {
    const circle = await this.database.asUser(auth.userId, async (tx) => {
      await this.lock(tx, circleId);
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (
        before.kind === 'pair' ||
        before.myRole !== 'owner' ||
        before.myStatus !== 'active' ||
        userId === auth.userId
      ) {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      }
      const target = before.members.find(
        (member) => member.userId === userId && member.status === 'active',
      );
      if (target === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      if (target.role === role) return before;
      if (role === 'member') {
        const [row] = await tx
          .select({ createdBy: circles.createdBy })
          .from(circles)
          .where(eq(circles.id, circleId));
        if (row?.createdBy === userId) {
          throw new ApiError(HttpStatus.FORBIDDEN, 'CREATOR_ADMIN');
        }
      }
      await tx
        .update(circleMembers)
        .set({ role })
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, userId)));
      if (role === 'member' && before.expiresAt !== undefined) {
        await tx
          .update(invites)
          .set({ revokedAt: new Date() })
          .where(
            and(
              eq(invites.circleId, circleId),
              eq(invites.createdBy, userId),
              isNull(invites.revokedAt),
            ),
          );
      }
      return this.mustRead(tx, circleId, auth.userId);
    });
    await this.changed(circle);
    return circle;
  }

  /** Invites someone into a group by username; they join only if they accept. */
  async inviteUser(auth: AuthContext, circleId: string, username: string): Promise<Circle> {
    await this.limit(auth.userId);
    const circle = await this.database.asUser(auth.userId, async (tx) => {
      // Into an event only its admins invite (docs/ADR/0020; app.invite_user holds it too).
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (before.expiresAt !== undefined && before.myRole !== 'owner') {
        throw new ApiError(HttpStatus.FORBIDDEN, 'FORBIDDEN');
      }
      const result = await tx.execute<{ ok: boolean }>(
        sql`SELECT app.invite_user(${circleId}, ${username}) AS ok`,
      );
      if (result.rows[0]?.ok !== true) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return this.mustRead(tx, circleId, auth.userId);
    });
    await this.changed(circle);
    const invitee = circle.members.find(
      (member) => member.username === username && member.status === 'invited',
    );
    if (invitee !== undefined)
      await this.notifier.notify([invitee.userId], 'circleInvite', circle.id);
    return circle;
  }

  /**
   * Friend request by username: a pair circle where the other side is invited. The answer for an
   * unknown name and for yourself is the same 404 (no hint beyond what the name check gives).
   */
  async requestFriend(
    auth: Pick<AuthContext, 'userId'>,
    username: string,
    /** A parent already said yes (docs/ADR/0023 §5). */
    approved = false,
  ): Promise<Circle> {
    await this.limit(auth.userId);
    if (!approved) await this.askGuardians(auth.userId, username);
    const circle = await this.database.asUser(auth.userId, async (tx) => {
      const result = await tx.execute<{ id: string | null }>(
        sql`SELECT app.request_friend(${username}) AS id`,
      );
      const id = result.rows[0]?.id ?? null;
      if (id === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      return this.mustRead(tx, id, auth.userId);
    });
    await this.changed(circle);
    const other = circle.members.find((member) => member.userId !== auth.userId);
    if (other !== undefined) {
      await this.notifier.notify(
        [other.userId],
        other.status === 'invited' ? 'friendRequest' : 'friendAccepted',
        circle.id,
      );
    }
    return circle;
  }

  /**
   * Starts a new epoch when the current one is older than the rekey interval (PROTOCOL §4: every
   * 24 h). Any active member may ask; earlier asks are a no-op that return the current epoch.
   */
  async rekey(auth: AuthContext, circleId: string): Promise<Circle> {
    const result = await this.limiter.hit(
      `rekey:${auth.userId}`,
      CIRCLE_LIMITS.rekeysPerHour,
      HOUR,
    );
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
    const { circle, started } = await this.database.asUser(auth.userId, async (tx) => {
      await this.lock(tx, circleId);
      const before = await this.mustRead(tx, circleId, auth.userId);
      if (before.myStatus !== 'active') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      if (Date.now() - before.epochStartedAt < REKEY_INTERVAL_MS) {
        return { circle: before, started: false };
      }
      await this.startEpoch(tx, circleId);
      return { circle: await this.mustRead(tx, circleId, auth.userId), started: true };
    });
    if (started) await this.changed(circle);
    return circle;
  }

  /**
   * A 15-17 child's new friend waits for a parent's yes (docs/ADR/0023 §5): the request is kept,
   * the parents hear it, the child gets 403 GUARDIAN_APPROVAL. Nothing when no yes is needed.
   */
  private async askGuardians(userId: string, username: string): Promise<void> {
    const asked = await this.database.asUser(userId, (tx) =>
      tx.execute<{ guardian: string }>(
        sql`SELECT app.ask_guardians_for_friend(${username}) AS guardian`,
      ),
    );
    const parents = asked.rows.map((row) => row.guardian);
    if (parents.length === 0) return;
    await this.events.publish([userId, ...parents], { type: 'guardians.changed' });
    await this.notifier.notify(parents, 'guardianApproval', userId);
    throw new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_APPROVAL');
  }

  /** Tells everyone in a circle that it changed, reading it as `userId` (a member). */
  async announce(userId: string, circleId: string): Promise<void> {
    const circle = await this.database.asUser(userId, (tx) => this.read(tx, circleId, userId));
    if (circle !== null) await this.changed(circle);
  }

  /** Tells co-members that a profile they show changed (name, avatar). */
  async profileChanged(userId: string): Promise<void> {
    const circlesOfUser = await this.database.asUser(userId, async (tx) => {
      const rows = await tx
        .select({ id: circleMembers.circleId })
        .from(circleMembers)
        .where(
          and(
            eq(circleMembers.userId, userId),
            inArray(circleMembers.status, ['invited', 'active']),
          ),
        );
      const found = await Promise.all(rows.map((row) => this.read(tx, row.id, userId)));
      return found.filter((circle): circle is Circle => circle !== null);
    });
    for (const circle of circlesOfUser) await this.changed(circle);
  }

  // ---------------------------------------------------------------------------------------------

  /** A new device for a user: every circle they are active in starts a new epoch. */
  private async startEpochsForDevice(userId: string): Promise<void> {
    const changedCircles = await this.database.asUser(userId, async (tx) => {
      const rows = await tx
        .select({ id: circleMembers.circleId })
        .from(circleMembers)
        .where(and(eq(circleMembers.userId, userId), eq(circleMembers.status, 'active')));
      const result: Circle[] = [];
      for (const row of rows) {
        await this.startEpoch(tx, row.id);
        const circle = await this.read(tx, row.id, userId);
        if (circle !== null) result.push(circle);
      }
      return result;
    });
    for (const circle of changedCircles) await this.changed(circle);
  }

  /** Moves a circle to a new key epoch and drops distributions the protocol no longer accepts. */
  async startEpoch(tx: Tx, circleId: string): Promise<void> {
    await tx.execute(sql`SELECT app.start_epoch(${circleId})`);
  }

  /** Serialises membership changes of one circle until the transaction ends. */
  private async lock(tx: Tx, circleId: string): Promise<void> {
    await tx.execute(sql`SELECT app.lock_circle(${circleId})`);
  }

  /**
   * An owner is leaving a group. The longest-standing active member becomes owner (unless another
   * owner remains). With nobody active left, open invitations are withdrawn: no one could accept
   * into a group nobody runs. Returns the people whose invitation was withdrawn.
   */
  private async handOver(tx: Tx, circleId: string, owner: string): Promise<string[]> {
    const others = await tx
      .select({
        userId: circleMembers.userId,
        role: circleMembers.role,
        status: circleMembers.status,
      })
      .from(circleMembers)
      .where(
        and(
          eq(circleMembers.circleId, circleId),
          ne(circleMembers.userId, owner),
          inArray(circleMembers.status, ['invited', 'active']),
        ),
      )
      .orderBy(asc(circleMembers.joinedAt), asc(circleMembers.createdAt));
    const active = others.filter((member) => member.status === 'active');
    if (active.some((member) => member.role === 'owner')) return [];
    const heir = active[0];
    if (heir !== undefined) {
      await tx
        .update(circleMembers)
        .set({ role: 'owner' })
        .where(and(eq(circleMembers.circleId, circleId), eq(circleMembers.userId, heir.userId)));
      return [];
    }
    const invited = others.map((member) => member.userId);
    if (invited.length > 0) {
      await tx
        .update(circleMembers)
        .set({ status: 'removed', endedAt: new Date() })
        .where(and(eq(circleMembers.circleId, circleId), inArray(circleMembers.userId, invited)));
    }
    return invited;
  }

  /**
   * Someone is coming in (and with them a new epoch for everyone): refused, with nothing changed,
   * once the circle had too many arrivals this hour (QA Faz 8 O6). Call inside the transaction.
   */
  async limitJoins(circleId: string): Promise<void> {
    const result = await this.limiter.hit(
      `circle-joins:${circleId}`,
      CIRCLE_LIMITS.joinsPerCirclePerHour,
      HOUR,
    );
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }

  private async limit(userId: string): Promise<void> {
    const result = await this.limiter.hit(
      `invite:${userId}`,
      CIRCLE_LIMITS.invitationsPerHour,
      HOUR,
    );
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }

  private async changed(circle: Circle): Promise<void> {
    await this.events.publish(audience(circle), {
      type: 'circle.changed',
      circleId: circle.id,
      epoch: circle.epoch,
    });
  }

  /** After the caller left a circle: the others hear the new state (read as one of them). */
  private async notifyById(userIds: string[], circleId: string, leaver: string): Promise<void> {
    const reader = userIds.find((userId) => userId !== leaver);
    if (reader === undefined) return;
    const circle = await this.database.asUser(reader, (tx) => this.read(tx, circleId, reader));
    if (circle === null) {
      await this.events.publish(userIds, { type: 'circle.gone', circleId });
      return;
    }
    await this.changed(circle);
  }

  async mustRead(tx: Tx, circleId: string, me: string): Promise<Circle> {
    const circle = await this.read(tx, circleId, me);
    if (circle === null) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    return circle;
  }

  /** The circle as `me` sees it, or null when `me` is not in it (or a pair has lost its other half). */
  async read(tx: Tx, circleId: string, me: string): Promise<Circle | null> {
    const [row] = await tx.select().from(circles).where(eq(circles.id, circleId));
    if (row === undefined) return null;
    const result = await tx.execute<CardRow>(
      sql`SELECT * FROM app.circle_member_cards(${circleId})`,
    );
    const members = result.rows.map(card);
    const mine = members.find((member) => member.userId === me);
    if (mine === undefined) return null;
    if (row.kind === 'pair' && members.length < 2) return null;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      epoch: row.epoch,
      epochStartedAt: row.epochStartedAt.getTime(),
      myRole: mine.role,
      myStatus: mine.status,
      members,
      ...(row.expiresAt === null
        ? {}
        : { startedAt: row.createdAt.getTime(), expiresAt: row.expiresAt.getTime() }),
    };
  }
}
