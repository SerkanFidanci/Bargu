import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  type CheckinCreate,
  checkinCreateSchema,
  type CheckinExtend,
  checkinExtendSchema,
  type CheckinInbox,
  type CheckinList,
  type CheckinRefresh,
  checkinRefreshSchema,
  type CheckinReply,
  CLIENT_LEVEL_HEADER,
  clientLevelOf,
} from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CheckinsService } from './checkins.service.js';

const id = new ZodPipe(z.uuid());

/** Arrival checks (docs/ADR/0039). Every change signed like every other. */
@Controller('v1/checkins')
export class CheckinsController {
  constructor(private readonly checkins: CheckinsService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  create(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Body(new ZodPipe(checkinCreateSchema)) body: CheckinCreate,
  ): Promise<CheckinReply> {
    this.checkins.requireLevel(clientLevelOf(level));
    return this.checkins.create(auth, body.id, body.openAt, body.boxes);
  }

  @Put(':id/boxes')
  refresh(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) checkinId: string,
    @Body(new ZodPipe(checkinRefreshSchema)) body: CheckinRefresh,
  ): Promise<CheckinReply> {
    return this.checkins.refresh(auth, checkinId, body.boxes);
  }

  @Post(':id/extend')
  @HttpCode(HttpStatus.OK)
  extend(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) checkinId: string,
    @Body(new ZodPipe(checkinExtendSchema)) body: CheckinExtend,
  ): Promise<CheckinReply> {
    return this.checkins.extend(auth, checkinId, body.openAt, body.boxes);
  }

  @Delete(':id')
  cancel(
    @CurrentAuth() auth: AuthContext,
    @Param('id', id) checkinId: string,
  ): Promise<CheckinReply> {
    return this.checkins.cancel(auth, checkinId);
  }

  @Get()
  list(@CurrentAuth() auth: AuthContext): Promise<CheckinList> {
    return this.checkins.list(auth);
  }

  @Get('inbox')
  inbox(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
  ): Promise<CheckinInbox> {
    this.checkins.requireLevel(clientLevelOf(level));
    return this.checkins.inbox(auth);
  }

  @Post(':id/ack')
  @HttpCode(HttpStatus.NO_CONTENT)
  async ack(@CurrentAuth() auth: AuthContext, @Param('id', id) checkinId: string): Promise<void> {
    await this.checkins.ack(auth, checkinId);
  }
}
