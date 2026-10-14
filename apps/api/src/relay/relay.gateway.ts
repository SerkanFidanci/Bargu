import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import {
  type PublishReply,
  locationPublishSchema,
  locationWithdrawSchema,
  type MessageEnvelope,
  watchRequestSchema,
} from '@bargu/schemas';
import type { Socket } from 'socket.io';

import { ApiError } from '../common/api-error.js';
import { GATEWAY_OPTIONS } from '../events/events.gateway.js';
import { EventsService } from '../events/events.service.js';
import { RelayService } from './relay.service.js';

type Ack<T> = T | { error: string };

/**
 * Location messages over the event socket (same connection and handshake as events.gateway): the
 * phone publishes while the app is open, asks for a snapshot after (re)connecting, and tells
 * others when it looks at a circle. Replies are acknowledgements, never thrown errors.
 */
@WebSocketGateway(GATEWAY_OPTIONS)
export class RelayGateway {
  constructor(
    private readonly relay: RelayService,
    private readonly events: EventsService,
  ) {}

  @SubscribeMessage('publish')
  async publish(socket: Socket, payload: unknown): Promise<Ack<PublishReply>> {
    const connection = this.events.connectionOf(socket);
    const parsed = locationPublishSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    return this.relay.publish(connection.auth, parsed.data.envelopes);
  }

  @SubscribeMessage('locations')
  async locations(socket: Socket): Promise<Ack<{ envelopes: MessageEnvelope[] }>> {
    const connection = this.events.connectionOf(socket);
    if (connection === undefined) return { error: 'UNAUTHENTICATED' };
    return { envelopes: await this.relay.snapshot(connection.auth) };
  }

  @SubscribeMessage('withdraw')
  async withdraw(socket: Socket, payload: unknown): Promise<Ack<{ ok: true }>> {
    const connection = this.events.connectionOf(socket);
    const parsed = locationWithdrawSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    await this.relay.withdraw(connection.auth, parsed.data.circleIds);
    return { ok: true };
  }

  @SubscribeMessage('watch')
  async watch(socket: Socket, payload: unknown): Promise<Ack<{ ok: true }>> {
    const connection = this.events.connectionOf(socket);
    const parsed = watchRequestSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    try {
      await this.relay.watch(connection.auth, parsed.data.circleId);
    } catch (error) {
      return { error: error instanceof ApiError ? error.code : 'INTERNAL' };
    }
    return { ok: true };
  }
}
