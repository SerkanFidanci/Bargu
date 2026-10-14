import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DeliveredEvent, ResumeReply, ServerEvent } from '@bargu/schemas';
import type { Server, Socket } from 'socket.io';

import type { AuthContext } from '../auth/request-context.js';

import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';

/** A user's missed events are kept this long (BARGU_PLAN §3.4: 24-hour stream). */
export const EVENT_RETENTION_SECONDS = 24 * 3600;
/** At most this many are kept per user; a phone further behind reloads everything (snapshot). */
export const EVENT_STREAM_LENGTH = 500;

const streamKey = (userId: string) => `ev:${userId}`;

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
 * to their connected sockets. Events say what changed, never personal data or keys.
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger('Events');
  private server: Server | null = null;
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
   * the latest matters (locations) and that phones catch up on by asking for a snapshot.
   */
  emitLive(userIds: Iterable<string>, name: string, payload: unknown): void {
    const rooms = [...new Set(userIds)].map(userRoom);
    if (rooms.length > 0) this.server?.to(rooms).emit(name, payload);
  }

  /** A live message to every connected phone (things that are the same for everyone). */
  emitAll(name: string, payload: unknown): void {
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

  /** Called by the gateway once the Socket.io server exists. */
  attach(server: Server): void {
    this.server = server;
  }

  /**
   * Publishes after the change is committed. A failure here must not undo the change: it is
   * logged, and affected phones catch up through a snapshot on their next resume.
   */
  async publish(userIds: Iterable<string>, event: ServerEvent): Promise<void> {
    const at = Date.now();
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
        const delivered: DeliveredEvent = { id, at, event };
        this.server?.to(userRoom(userId)).emit('event', delivered);
      } catch (error) {
        this.logger.warn(
          `event ${event.type} not delivered: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      }
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

  /** Closes a device's live connections (logout, device replaced). */
  disconnectDevice(deviceId: string): void {
    this.server?.in(deviceRoom(deviceId)).disconnectSockets(true);
  }
}
