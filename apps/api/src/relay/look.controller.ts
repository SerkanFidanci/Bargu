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
 * Look messages over HTTP (the live socket has the same): the cosmetics a member chose and the
 * server's pass for them, sealed for one circle (docs/ADR/0025 §3). Kept 30 days, latest only;
 * the relay sees ciphertext only, never which look.
 */
@Controller('v1/looks')
export class LookController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(locationPublishSchema)) body: LocationPublish,
  ): Promise<PublishReply> {
    return this.relay.publishLook(auth, body.envelopes);
  }

  @Get()
  async snapshot(@CurrentAuth() auth: AuthContext): Promise<{ envelopes: MessageEnvelope[] }> {
    return { envelopes: await this.relay.looks(auth) };
  }
}
