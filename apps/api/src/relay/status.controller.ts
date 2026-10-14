import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  type MessageEnvelope,
  type PublishReply,
  locationWithdrawSchema,
  type StatusPublish,
  statusPublishSchema,
} from '@bargu/schemas';
import type { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RelayService } from './relay.service.js';

/**
 * Statuses (emoji and short text, at most a day) over HTTP; the live socket has the same
 * (relay.gateway). Encrypted per circle like locations: the server keeps ciphertext only.
 */
@Controller('v1/statuses')
export class StatusController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(statusPublishSchema)) body: StatusPublish,
  ): Promise<PublishReply> {
    return this.relay.publishStatus(auth, body.envelopes, body.ttlSeconds);
  }

  @Get()
  async snapshot(@CurrentAuth() auth: AuthContext): Promise<{ envelopes: MessageEnvelope[] }> {
    return { envelopes: await this.relay.statuses(auth) };
  }

  @Post('withdraw')
  @HttpCode(HttpStatus.NO_CONTENT)
  async withdraw(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(locationWithdrawSchema)) body: z.infer<typeof locationWithdrawSchema>,
  ): Promise<void> {
    await this.relay.withdrawStatus(auth, body.circleIds);
  }
}
