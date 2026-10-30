import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  CLIENT_LEVEL_HEADER,
  clientLevelOf,
  type RollcallAnswer,
  rollcallAnswerSchema,
  type RollcallReply,
  type RollcallSetting,
  rollcallSettingSchema,
  type RollcallStart,
  rollcallStartSchema,
  type RollcallView,
} from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { RollcallsService } from './rollcalls.service.js';

const id = new ZodPipe(z.uuid());

/** Event roll calls (docs/ADR/0040). Every change signed like every other. */
@Controller('v1')
export class RollcallsController {
  constructor(private readonly rollcalls: RollcallsService) {}

  @Post('circles/:circleId/rollcalls')
  @HttpCode(HttpStatus.OK)
  start(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('circleId', id) circleId: string,
    @Body(new ZodPipe(rollcallStartSchema)) body: RollcallStart,
  ): Promise<RollcallReply> {
    this.rollcalls.requireLevel(clientLevelOf(level));
    return this.rollcalls.start(auth, circleId, body.envelope, body.pushes);
  }

  @Post('circles/:circleId/rollcalls/:rollcallId/answer')
  @HttpCode(HttpStatus.OK)
  answer(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('circleId', id) circleId: string,
    @Param('rollcallId', id) rollcallId: string,
    @Body(new ZodPipe(rollcallAnswerSchema)) body: RollcallAnswer,
  ): Promise<RollcallReply> {
    this.rollcalls.requireLevel(clientLevelOf(level));
    return this.rollcalls.answer(auth, circleId, rollcallId, body.envelope);
  }

  @Post('circles/:circleId/rollcalls/:rollcallId/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', id) circleId: string,
    @Param('rollcallId', id) rollcallId: string,
  ): Promise<RollcallReply> {
    return this.rollcalls.close(auth, circleId, rollcallId);
  }

  @Get('circles/:circleId/rollcalls/current')
  async current(
    @CurrentAuth() auth: AuthContext,
    @Param('circleId', id) circleId: string,
  ): Promise<RollcallView> {
    return { rollcall: await this.rollcalls.current(auth, circleId) };
  }

  @Get('me/rollcalls')
  setting(@CurrentAuth() auth: AuthContext): Promise<RollcallSetting> {
    return this.rollcalls.setting(auth);
  }

  @Put('me/rollcalls')
  setSetting(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(rollcallSettingSchema)) body: RollcallSetting,
  ): Promise<RollcallSetting> {
    return this.rollcalls.setSetting(auth, body.on);
  }
}
