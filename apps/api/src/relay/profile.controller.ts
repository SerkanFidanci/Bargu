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
 * Profile messages over HTTP (the live socket has the same): each carries the key to the sender's
 * encrypted profile photo, sealed for one circle (docs/ADR/0014). Kept 30 days, latest only.
 */
@Controller('v1/profile-keys')
export class ProfileController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(locationPublishSchema)) body: LocationPublish,
  ): Promise<PublishReply> {
    return this.relay.publishProfile(auth, body.envelopes);
  }

  @Get()
  async snapshot(@CurrentAuth() auth: AuthContext): Promise<{ envelopes: MessageEnvelope[] }> {
    return { envelopes: await this.relay.profiles(auth) };
  }
}
