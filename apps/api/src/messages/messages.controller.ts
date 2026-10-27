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
  Query,
} from '@nestjs/common';
import {
  type ChatRecord,
  type ChatSendReply,
  CLIENT_LEVEL_HEADER,
  chatCircleRequestSchema,
  chatDirectRequestSchema,
  chatListQuerySchema,
  clientLevelOf,
  type Media,
  mediaUploadSchema,
  type ReportRequest,
  reportRequestSchema,
} from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { MEDIA_UPLOAD_ROUTE, REPORT_ROUTE } from '../http/http-adapter.js';
import { MessagesService } from './messages.service.js';
import { ReportsService } from './reports.service.js';

const id = new ZodPipe(z.uuid());

/**
 * Messages and moments (docs/ADR/0035 §6): items for a circle or a person, their photo files, and
 * the people one blocked. Only apps that know them (CLIENT_LEVEL_FOR.messages) use these routes.
 */
@Controller('v1')
export class MessagesController {
  constructor(
    private readonly messages: MessagesService,
    private readonly reports: ReportsService,
  ) {}

  @Post('chat/circles/:circleId')
  @HttpCode(HttpStatus.OK)
  toCircle(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('circleId', id) circleId: string,
    @Body(new ZodPipe(chatCircleRequestSchema)) body: z.infer<typeof chatCircleRequestSchema>,
  ): Promise<ChatSendReply> {
    this.messages.requireLevel(clientLevelOf(level));
    return this.messages.toCircle(auth, circleId, body.envelope, body.blobId, body.pushes);
  }

  @Post('chat/people/:userId')
  @HttpCode(HttpStatus.OK)
  toPerson(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('userId', id) userId: string,
    @Body(new ZodPipe(chatDirectRequestSchema)) body: z.infer<typeof chatDirectRequestSchema>,
  ): Promise<ChatSendReply> {
    this.messages.requireLevel(clientLevelOf(level));
    return this.messages.toPerson(auth, userId, body.envelope, body.blobId, body.pushes);
  }

  /** What arrived while the app was away: read when it opens and when the socket comes back. */
  @Get('chat')
  async list(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Query(new ZodPipe(chatListQuerySchema)) query: z.infer<typeof chatListQuerySchema>,
  ): Promise<{ items: ChatRecord[] }> {
    this.messages.requireLevel(clientLevelOf(level));
    return { items: await this.messages.list(auth, query.after) };
  }

  @Delete('chat/:itemId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('itemId', id) itemId: string,
  ): Promise<void> {
    this.messages.requireLevel(clientLevelOf(level));
    await this.messages.remove(auth, itemId);
  }

  @Post(MEDIA_UPLOAD_ROUTE.slice('/v1/'.length))
  @HttpCode(HttpStatus.NO_CONTENT)
  async upload(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Body(new ZodPipe(mediaUploadSchema)) body: Media,
  ): Promise<void> {
    this.messages.requireLevel(clientLevelOf(level));
    await this.messages.upload(auth, body);
  }

  @Get('media/:blobId')
  download(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('blobId', id) blobId: string,
  ): Promise<Media> {
    this.messages.requireLevel(clientLevelOf(level));
    return this.messages.download(auth, blobId);
  }

  /** "Bildir" (docs/ADR/0035 §9): a person, or one of their items with that item's key. */
  @Post(REPORT_ROUTE.slice('/v1/'.length))
  @HttpCode(HttpStatus.NO_CONTENT)
  async report(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Body(new ZodPipe(reportRequestSchema)) body: ReportRequest,
  ): Promise<void> {
    this.messages.requireLevel(clientLevelOf(level));
    await this.reports.report(auth, body);
  }

  @Get('blocks')
  async blocked(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
  ): Promise<{ blocked: string[] }> {
    this.messages.requireLevel(clientLevelOf(level));
    return { blocked: await this.messages.blocked(auth) };
  }

  @Put('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async block(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('userId', id) userId: string,
  ): Promise<void> {
    this.messages.requireLevel(clientLevelOf(level));
    await this.messages.block(auth, userId);
  }

  @Delete('blocks/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unblock(
    @CurrentAuth() auth: AuthContext,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
    @Param('userId', id) userId: string,
  ): Promise<void> {
    this.messages.requireLevel(clientLevelOf(level));
    await this.messages.unblock(auth, userId);
  }
}
