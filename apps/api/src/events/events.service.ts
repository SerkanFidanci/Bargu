import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import {
  type DeliveredEvent,
  deliveredEventSchema,
  type LiveEvent,
  type ResumeReply,
  type ServerEvent,
  STREAM_EVENT,
} from '@bargu/schemas';
import { z } from 'zod';
import type { Server, Socket } from 'socket.io';

import type { AuthContext } from '../auth/request-context.js';

import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';

/** A user's missed events are kept this long (BARGU_PLAN §3.4: 24-hour stream). */
export const EVENT_RETENTION_SECONDS = 24 * 3600;
/** At most this many are kept per user; a phone further behind reloads everything (snapshot). */
export const EVENT_STREAM_LENGTH = 500;

const streamKey = (userId: string) => `ev:${userId}`;

/**
 * Stored events go to connected phones through this channel, from whichever process stored them:
 * the worker (which has no sockets) and every API instance alike (QA Faz 8 D2).
 */
export const LIVE_CHANNEL = 'events:live';
const liveSchema = z
  .object({ deliveries: z.array(z.object({ userId: z.uuid(), delivered: deliveredEventSchema })) })
  .strict();

/** A connected socket's identity and the token it presented (re-checked after joining). */
export interface SocketConnection {
  auth: AuthContext;
  token: string;
  resumes: number;
}
export const userRoom = (userId: string) => `user:${userId}`;
export const deviceRoom = (deviceId: string) => `device:${deviceId}`;

/** Stream ids are "<ms>-<seq>"; compares them numerically. */
function compareIds(a: string, b: string): number {
  const [aMs = 0, aSeq = 0] = a.split('-').map(Number);
  const [bMs = 0, bSeq = 0] = b.split('-').map(Number);
  return aMs === bMs ? aSeq - bSeq : aMs - bMs;
}

/**
 * Every state change other people (or the user's own phone) must see is an event: written to the
 * user's Redis stream, so a phone that was offline can resume where it left off, and pushed at once
 * to their connected sockets (through LIVE_CHANNEL, so the worker's events go live too). Events say
 * what changed, never personal data or keys.
 */
@Injectable()
export class EventsService implements OnModuleDestroy {
  private readonly logger = new Logger('Events');
  private server: Server | null = null;
  private subscriber: RedisClient | null = null;
  /** Who each connected socket acts for, set once by the handshake (events.gateway). */
  private readonly connections = new WeakMap<Socket, SocketConnection>();

  constructor(@Inject(REDIS) private readonly redis: RedisClient) {}

  bind(socket: Socket, connection: SocketConnection): void {
    this.connections.set(socket, connection);
  }

  /** The authenticated identity behind a socket (undefined before the handshake completed). */
  connectionOf(socket: Socket): SocketConnection | undefined {
    return this.connections.get(socket);
  }

  /**
   * Pushes a live message to users' connected phones, without storing it: for things where only
   * the latest matters (locations) and that phones catch up on by asking for a snapshot. The name
   * is one of LIVE_EVENTS (packages/schemas), so the app's contract test knows every message.
   */
  emitLive(userIds: Iterable<string>, name: LiveEvent, payload: unknown): void {
    const rooms = [...new Set(userIds)].map(userRoom);
    if (rooms.length > 0) this.server?.to(rooms).emit(name, payload);
  }

  /** A live message to every connected phone (things that are the same for everyone). */
  emitAll(name: LiveEvent, payload: unknown): void {
    this.server?.emit(name, payload);
  }

  /** Which of these users have the app open right now (a connected socket). */
  async online(userIds: Iterable<string>): Promise<Set<string>> {
    const result = new Set<string>();
    const server = this.server;
    if (server === null) return result;
    for (const userId of new Set(userIds)) {
      if ((await server.in(userRoom(userId)).fetchSockets()).length > 0) result.add(userId);
    }
    return result;
  }

  /**
   * Called by the gateway once the Socket.io server exists: from now on this process hands stored
   * events from the channel to its connected sockets.
   */
  attach(server: Server): void {
    this.server = server;
    let subscriber: RedisClient;
    try {
      subscriber = this.redis.duplicate();
    } catch (error) {
      // No live channel: events stay in the streams, phones get them on their next resume.
      this.logger.warn(
        `live channel unavailable: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return;
    }
    this.subscriber = subscriber;
    subscriber.on('error', (error: Error) => {
      this.logger.warn(`live channel: ${error.name}`);
    });
    void (async () => {
      await subscriber.connect();
      await subscriber.subscribe(LIVE_CHANNEL, (message) => {
        this.deliver(message);
      });
    })().catch((error: unknown) => {
      // Events stay in the streams: phones get them on their next resume.
      this.logger.warn(`live channel down: ${error instanceof Error ? error.name : 'unknown'}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    const subscriber = this.subscriber;
    this.subscriber = null;
    if (subscriber?.isOpen === true) await subscriber.close();
  }

  private deliver(message: string): void {
    const parsed = liveSchema.safeParse(JSON.parse(message));
    if (!parsed.success) return;
    for (const { userId, delivered } of parsed.data.deliveries) {
      this.server?.to(userRoom(userId)).emit(STREAM_EVENT, delivered);
    }
  }

  /**
   * Publishes after the change is committed. A failure here must not undo the change: it is
   * logged, and affected phones catch up through a snapshot on their next resume.
   */
  async publish(userIds: Iterable<string>, event: ServerEvent): Promise<void> {
    const at = Date.now();
    const deliveries: { userId: string; delivered: DeliveredEvent }[] = [];
    for (const userId of new Set(userIds)) {
      try {
        const key = streamKey(userId);
        const id = await this.redis.xAdd(
          key,
          '*',
          { e: JSON.stringify({ at, event }) },
          { TRIM: { strategy: 'MAXLEN', strategyModifier: '~', threshold: EVENT_STREAM_LENGTH } },
        );
        await this.redis.expire(key, EVENT_RETENTION_SECONDS);
        deliveries.push({ userId, delivered: { id, at, event } });
      } catch (error) {
        this.logger.warn(
          `event ${event.type} not delivered: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
    }
    if (deliveries.length === 0) return;
    try {
      await this.redis.publish(LIVE_CHANNEL, JSON.stringify({ deliveries }));
    } catch (error) {
      // Stored all the same: phones get it on their next resume.
      this.logger.warn(
        `event ${event.type} not live: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  /**
   * Events after `lastId`, oldest first. `snapshot: true` means some may be gone (trimmed, expired
   * or never seen): the phone reloads its state instead of trusting the gap.
   */
  async since(userId: string, lastId: string | null): Promise<ResumeReply> {
    const key = streamKey(userId);
    if (lastId === null) return this.snapshot(key);
    const [first] = (await this.redis.xRange(key, '-', '+', { COUNT: 1 })) ?? [];
    // Nothing kept (expired), or the phone's last event is older than everything kept: events in
    // between may have been trimmed, so the phone reloads instead of trusting the gap.
    if (first === undefined || compareIds(lastId, first.id) < 0) return this.snapshot(key);
    const entries =
      (await this.redis.xRange(key, `(${lastId}`, '+', { COUNT: EVENT_STREAM_LENGTH })) ?? [];
    const events: DeliveredEvent[] = [];
    for (const entry of entries) {
      const raw = entry.message.e;
      if (raw === undefined) continue;
      const { at, event } = JSON.parse(raw) as { at: number; event: ServerEvent };
      events.push({ id: entry.id, at, event });
    }
    return { events, snapshot: false, cursor: events.at(-1)?.id ?? lastId };
  }

  /**
   * "Reload everything", with the newest event id as the place to resume from afterwards: anything
   * newer reaches the phone live (it is already in its room) or on its next resume.
   */
  private async snapshot(key: string): Promise<ResumeReply> {
    const [latest] = (await this.redis.xRevRange(key, '+', '-', { COUNT: 1 })) ?? [];
    return { events: [], snapshot: true, cursor: latest?.id ?? null };
  }

  /**
   * Removes every stored event that names a circle from these users' streams (an event circle
   * ended: nothing about it may stay, docs/ADR/0017). Phones that missed them reload anyway.
   */
  async forgetCircle(userIds: Iterable<string>, circleId: string): Promise<void> {
    for (const userId of new Set(userIds)) {
      const key = streamKey(userId);
      const entries = (await this.redis.xRange(key, '-', '+')) ?? [];
      const naming = entries
        .filter((entry) => (entry.message.e ?? '').includes(circleId))
        .map((entry) => entry.id);
      if (naming.length > 0) await this.redis.xDel(key, naming);
    }
  }

  /** Closes a device's live connections (logout, device replaced). */
  disconnectDevice(deviceId: string): void {
    this.server?.in(deviceRoom(deviceId)).disconnectSockets(true);
  }
}
