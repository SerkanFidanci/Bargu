import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  type LocationPublish,
  locationPublishSchema,
  type MessageEnvelope,
  type PublishReply,
} from '@bargu/schemas';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RelayService } from './relay.service.js';

/**
 * `state` messages over HTTP (the live socket has the same): why a member's last location may be
 * old, sealed for one circle ("Neden eski?", docs/ADR/0028). Only the newest is kept per member
 * and circle; the relay sees ciphertext and a time, never the reason. A paused circle and a
 * non-member are refused. Whom the phone tells (ghost mode, each circle's sharing) is its own
 * rule: the relay does not know those settings.
 */
@Controller('v1/states')
export class StateController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(locationPublishSchema)) body: LocationPublish,
  ): Promise<PublishReply> {
    return this.relay.publishState(auth, body.envelopes);
  }

  @Get()
  async snapshot(@CurrentAuth() auth: AuthContext): Promise<{ envelopes: MessageEnvelope[] }> {
    return { envelopes: await this.relay.states(auth) };
  }
}
