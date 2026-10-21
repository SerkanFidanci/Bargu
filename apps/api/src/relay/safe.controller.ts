import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { type BumpReply, safeRequestSchema } from '@bargu/schemas';
import type { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RelayService } from './relay.service.js';

/**
 * "Güvendeyim" (docs/ADR/0029): forwarded like a poke, never stored, done once per message id. Needs
 * no plan and works in a paused circle: a safety feature is always free. Signed like every change.
 */
@Controller('v1/safe')
export class SafeController {
  constructor(private readonly relay: RelayService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  safe(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(safeRequestSchema)) body: z.infer<typeof safeRequestSchema>,
  ): Promise<BumpReply> {
    return this.relay.safe(auth, body.id, body.envelope, body.pushes);
  }
}
