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
import type { AuthContext } from '../auth/request-context.js';
import { RequestSignatures } from '../auth/request-signatures.js';
import { ApiError } from '../common/api-error.js';
import { deviceRoom, EventsService, userRoom } from './events.service.js';

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

const resumeSchema = z
  .object({
    lastEventId: z
      .string()
      .regex(/^\d{1,16}-\d{1,10}$/)
      .nullable(),
  })
  .strict();

/**
 * The single live connection per phone (BARGU_PLAN §3.4). WebSocket transport only (no long-polling,
 * so no sticky sessions). The handshake is authenticated like a signed HTTP request: access token,
 * live device and session, and a one-time device signature over "GET /v1/events".
 */
@WebSocketGateway({
  path: EVENTS_PATH,
  transports: ['websocket'],
  serveClient: false,
  cors: false,
  // Small control messages only; location relay (Faz 5) sizes its own limits.
  maxHttpBufferSize: 16 * 1024,
  pingInterval: 20_000,
  pingTimeout: 20_000,
})
export class EventsGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger('EventsGateway');
  /** Who each connected socket acts for, set once by the handshake middleware. */
  private readonly identities = new WeakMap<Socket, AuthContext>();

  constructor(
    private readonly events: EventsService,
    private readonly contexts: AuthContexts,
    private readonly signatures: RequestSignatures,
  ) {}

  afterInit(server: Server): void {
    this.events.attach(server);
    server.use((socket, next) => {
      this.authenticate(socket).then(
        (auth) => {
          this.identities.set(socket, auth);
          next();
        },
        (error: unknown) => {
          next(new Error(error instanceof ApiError ? error.code : 'UNAUTHENTICATED'));
        },
      );
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const identity = this.identities.get(socket);
    if (identity === undefined) {
      socket.disconnect(true);
      return;
    }
    await socket.join([userRoom(identity.userId), deviceRoom(identity.deviceId)]);
  }

  /** Missed events since the phone's last one (or a snapshot request), as the acknowledgement. */
  @SubscribeMessage('resume')
  async resume(socket: Socket, payload: unknown): Promise<ResumeReply> {
    const identity = this.identities.get(socket);
    const parsed = resumeSchema.safeParse(payload);
    if (identity === undefined || !parsed.success) {
      return { events: [], snapshot: true };
    }
    try {
      return await this.events.since(identity.userId, parsed.data.lastEventId);
    } catch (error) {
      this.logger.warn(`resume failed: ${error instanceof Error ? error.name : 'unknown'}`);
      return { events: [], snapshot: true };
    }
  }

  private async authenticate(socket: Socket): Promise<AuthContext> {
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
    return auth;
  }
}
