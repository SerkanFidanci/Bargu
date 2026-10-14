import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  type LocationPublish,
  locationPublishSchema,
  locationWithdrawSchema,
  type MessageEnvelope,
  type PublishReply,
} from '@bargu/schemas';
import type { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RelayService } from './relay.service.js';

/**
 * The same relay over HTTP, for a phone whose event socket is closed (app in the background, the
 * location service still running). Publishing and withdrawing are signed like every change.
 */
@Controller('v1/locations')
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(locationPublishSchema)) body: LocationPublish,
  ): Promise<PublishReply> {
    return this.relay.publish(auth, body.envelopes);
  }

  @Get()
  async snapshot(@CurrentAuth() auth: AuthContext): Promise<{ envelopes: MessageEnvelope[] }> {
    return { envelopes: await this.relay.snapshot(auth) };
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(locationWithdrawSchema)) body: z.infer<typeof locationWithdrawSchema>,
  ): Promise<void> {
    await this.relay.withdraw(auth, body.circleIds);
  }
}
