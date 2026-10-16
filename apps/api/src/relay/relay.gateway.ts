import { SubscribeMessage, WebSocketGateway } from '@nestjs/websockets';
import {
  type BumpReply,
  bumpRequestSchema,
  type PublishReply,
  locationPublishSchema,
  locationWithdrawSchema,
  type MessageEnvelope,
  statusPublishSchema,
  watchRequestSchema,
} from '@bargu/schemas';
import type { Socket } from 'socket.io';

import { ApiError } from '../common/api-error.js';
import { GATEWAY_OPTIONS } from '../events/events.gateway.js';
import { EventsService } from '../events/events.service.js';
import { RelayService } from './relay.service.js';

type Ack<T> = T | { error: string };

/**
 * Relay messages over the event socket (same connection and handshake as events.gateway): the
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

  @SubscribeMessage('bump')
  async bump(socket: Socket, payload: unknown): Promise<Ack<BumpReply>> {
    const connection = this.events.connectionOf(socket);
    const parsed = bumpRequestSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    return this.relay.bump(connection.auth, parsed.data.envelope, parsed.data.pushes);
  }

  @SubscribeMessage('status')
  async status(socket: Socket, payload: unknown): Promise<Ack<PublishReply>> {
    const connection = this.events.connectionOf(socket);
    const parsed = statusPublishSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    return this.relay.publishStatus(connection.auth, parsed.data.envelopes, parsed.data.ttlSeconds);
  }

  @SubscribeMessage('profile')
  async profile(socket: Socket, payload: unknown): Promise<Ack<PublishReply>> {
    const connection = this.events.connectionOf(socket);
    const parsed = locationPublishSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    return this.relay.publishProfile(connection.auth, parsed.data.envelopes);
  }

  @SubscribeMessage('profiles')
  async profiles(socket: Socket): Promise<Ack<{ envelopes: MessageEnvelope[] }>> {
    const connection = this.events.connectionOf(socket);
    if (connection === undefined) return { error: 'UNAUTHENTICATED' };
    return { envelopes: await this.relay.profiles(connection.auth) };
  }

  @SubscribeMessage('look')
  async look(socket: Socket, payload: unknown): Promise<Ack<PublishReply>> {
    const connection = this.events.connectionOf(socket);
    const parsed = locationPublishSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    return this.relay.publishLook(connection.auth, parsed.data.envelopes);
  }

  @SubscribeMessage('looks')
  async looks(socket: Socket): Promise<Ack<{ envelopes: MessageEnvelope[] }>> {
    const connection = this.events.connectionOf(socket);
    if (connection === undefined) return { error: 'UNAUTHENTICATED' };
    return { envelopes: await this.relay.looks(connection.auth) };
  }

  @SubscribeMessage('statuses')
  async statuses(socket: Socket): Promise<Ack<{ envelopes: MessageEnvelope[] }>> {
    const connection = this.events.connectionOf(socket);
    if (connection === undefined) return { error: 'UNAUTHENTICATED' };
    return { envelopes: await this.relay.statuses(connection.auth) };
  }

  @SubscribeMessage('status.withdraw')
  async withdrawStatus(socket: Socket, payload: unknown): Promise<Ack<{ ok: true }>> {
    const connection = this.events.connectionOf(socket);
    const parsed = locationWithdrawSchema.safeParse(payload);
    if (connection === undefined || !parsed.success) return { error: 'VALIDATION_FAILED' };
    await this.relay.withdrawStatus(connection.auth, parsed.data.circleIds);
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
