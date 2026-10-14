import { HttpStatus, Logger } from '@nestjs/common';
import {
  type OnGatewayConnection,
  type OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { ResumeReply } from '@bargu/schemas';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';

import { AuthContexts } from '../auth/auth-contexts.js';
import { RequestSignatures } from '../auth/request-signatures.js';
import { ApiError } from '../common/api-error.js';
import { deviceRoom, EventsService, type SocketConnection, userRoom } from './events.service.js';

/** Path of the event socket; the handshake signature covers "GET <this path>". */
export const EVENTS_PATH = '/v1/events';

const handshakeSchema = z
  .object({
    token: z.string().max(4096),
    ts: z.string().max(20),
    nonce: z.string().max(64),
    sig: z.string().max(128),
  })
  .strict();

/** A phone resumes once per connection; a few more are tolerated, then the connection closes. */
export const RESUMES_PER_CONNECTION = 5;

const resumeSchema = z
  .object({
    lastEventId: z
      .string()
      .regex(/^\d{1,16}-\d{1,10}$/)
      .nullable(),
  })
  .strict();

/** Shared by every gateway on the event socket (Nest gives gateways on one path one server). */
export const GATEWAY_OPTIONS = {
  path: EVENTS_PATH,
  transports: ['websocket'],
  serveClient: false,
  cors: false,
  // Small control messages and location publishes (at most 10 envelopes of about 1 KB).
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 20_000,
  pingTimeout: 20_000,
};

/**
 * The single live connection per phone (BARGU_PLAN §3.4). WebSocket transport only (no long-polling,
 * so no sticky sessions). The handshake is authenticated like a signed HTTP request: access token,
 * live device and session, and a one-time device signature over "GET /v1/events". A connection
 * lives no longer than its access token (the phone reconnects with a fresh one), closes when the
 * device signs out, is replaced or has its session revoked, and replaces an older connection of
 * the same device.
 */
@WebSocketGateway(GATEWAY_OPTIONS)
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('EventsGateway');
  constructor(
    private readonly events: EventsService,
    private readonly contexts: AuthContexts,
    private readonly signatures: RequestSignatures,
  ) {}

  afterInit(server: Server): void {
    this.events.attach(server);
    server.use((socket, next) => {
      this.authenticate(socket).then(
        (connection) => {
          this.events.bind(socket, connection);
          next();
        },
        (error: unknown) => {
          next(new Error(error instanceof ApiError ? error.code : 'UNAUTHENTICATED'));
        },
      );
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const connection = this.events.connectionOf(socket);
    if (connection === undefined) {
      socket.disconnect(true);
      return;
    }
    const { auth, token } = connection;
    // One connection per device: a newer one replaces the older (it is not in the room yet).
    this.events.disconnectDevice(auth.deviceId);
    await socket.join([userRoom(auth.userId), deviceRoom(auth.deviceId)]);
    // A sign-out or device change that committed while the handshake ran closed the device's
    // sockets before this one joined: check again now that it is in the rooms.
    try {
      await this.contexts.resolve(token);
    } catch {
      socket.disconnect(true);
      return;
    }
    const expiry = setTimeout(
      () => {
        socket.disconnect(true);
      },
      Math.max(0, auth.expiresAt - Date.now()),
    );
    socket.once('disconnect', () => {
      clearTimeout(expiry);
    });
  }

  /** Missed events since the phone's last one (or a snapshot request), as the acknowledgement. */
  @SubscribeMessage('resume')
  async resume(socket: Socket, payload: unknown): Promise<ResumeReply> {
    const connection = this.events.connectionOf(socket);
    const parsed = resumeSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) {
      return { events: [], snapshot: true, cursor: null };
    }
    connection.resumes += 1;
    if (connection.resumes > RESUMES_PER_CONNECTION) {
      socket.disconnect(true);
      return { events: [], snapshot: true, cursor: null };
    }
    try {
      return await this.events.since(connection.auth.userId, parsed.data.lastEventId);
    } catch (error) {
      this.logger.warn(`resume failed: ${error instanceof Error ? error.name : 'unknown'}`);
      return { events: [], snapshot: true, cursor: null };
    }
  }

  private async authenticate(socket: Socket): Promise<SocketConnection> {
    const parsed = handshakeSchema.safeParse(socket.handshake.auth);
    if (!parsed.success) throw new ApiError(HttpStatus.UNAUTHORIZED, 'UNAUTHENTICATED');
    const { token, ts, nonce, sig } = parsed.data;
    const auth = await this.contexts.resolve(token);
    await this.signatures.verifyParts(
      {
        method: 'GET',
        path: EVENTS_PATH,
        body: new Uint8Array(0),
        signature: sig,
        timestamp: ts,
        nonce,
      },
      auth.deviceId,
      auth.identityKey,
    );
    return { auth, token, resumes: 0 };
  }
}
