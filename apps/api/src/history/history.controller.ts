import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import { type HistoryRecord, historyPutSchema, historyQuerySchema } from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { HistoryService } from './history.service.js';

/** All of the caller's own history, every circle (QA Faz 8 G5). */
@Controller('v1/me/history')
export class MyHistoryController {
  constructor(private readonly history: HistoryService) {}

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  removeAll(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.history.removeAll(auth);
  }
}

/** Location history of circles: quarter hours of members' trails (docs/ADR/0019). */
@Controller('v1/circles/:circleId/history')
export class HistoryController {
  constructor(private readonly history: HistoryService) {}

  @Put(':slot')
  @HttpCode(HttpStatus.NO_CONTENT)
  async put(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
    @Param('slot', new ZodPipe(z.coerce.number().int().nonnegative())) slot: number,
    @Body(new ZodPipe(historyPutSchema)) body: z.infer<typeof historyPutSchema>,
  ): Promise<void> {
    await this.history.put(auth, circleId, slot, body.envelope);
  }

  @Get(':userId')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
    @Param('userId', new ZodPipe(z.uuid())) userId: string,
    @Query(new ZodPipe(historyQuerySchema)) query: { from: number; to: number },
  ): Promise<{ chunks: HistoryRecord[] }> {
    return { chunks: await this.history.list(auth, circleId, userId, query) };
  }

  /** "Geçmişimi sil": the caller's own trail in the circle. */
  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', new ZodPipe(z.uuid())) circleId: string,
  ): Promise<void> {
    await this.history.remove(auth, circleId);
  }
}
