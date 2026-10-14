import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { type BumpReply, bumpRequestSchema } from '@bargu/schemas';
import type { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RelayService } from './relay.service.js';

/** Pokes over HTTP (the live socket has the same, relay.gateway): forwarded, never stored. */
@Controller('v1/bumps')
export class BumpController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  bump(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(bumpRequestSchema)) body: z.infer<typeof bumpRequestSchema>,
  ): Promise<BumpReply> {
    return this.relay.bump(auth, body.envelope);
  }
}
