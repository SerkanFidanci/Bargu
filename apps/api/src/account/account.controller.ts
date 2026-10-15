import { Body, Controller, Get, HttpCode, HttpStatus, Post, Put, Req } from '@nestjs/common';
import {
  type AccountExport,
  type HistoryConsent,
  historyConsentSchema,
  type NoticeRead,
  noticeReadSchema,
  type PrivacyState,
  type WebRevoke,
  webRevokeSchema,
} from '@bargu/schemas';
import { z } from 'zod';

import {
  type AuthContext,
  type AuthedRequest,
  CurrentAuth,
  Public,
  Unsigned,
} from '../auth/request-context.js';
import { WebAccountService } from '../auth/web-account.service.js';
import { ApiError } from '../common/api-error.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AccountService } from './account.service.js';

/** Deleting is never a side effect: the request says so in its body. */
const deleteSchema = z.object({ confirm: z.boolean() }).strict();

/** The account as its owner controls it (docs/ADR/0022). */
@Controller('v1')
export class AccountController {
  constructor(
    private readonly account: AccountService,
    private readonly web: WebAccountService,
  ) {}

  /** "Hesabımı sil" in the app: no undo; the phone signs out and wipes itself. */
  @Post('me/delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(deleteSchema)) body: z.infer<typeof deleteSchema>,
  ): Promise<void> {
    if (!body.confirm) throw new ApiError(HttpStatus.BAD_REQUEST, 'VALIDATION_FAILED');
    await this.account.delete(auth.userId);
  }

  /** "Hesabımı sil" on the account web page, with the session its emailed code gave. */
  @Post('web/delete-account')
  @Public()
  @Unsigned()
  @HttpCode(HttpStatus.OK)
  async deleteFromWeb(
    @Body(new ZodPipe(webRevokeSchema)) body: WebRevoke,
    @Req() request: AuthedRequest,
  ): Promise<{ deleted: true }> {
    const userId = await this.web.takeSession(body.token, request.ip, 'webDelete');
    await this.account.delete(userId);
    return { deleted: true };
  }

  @Get('me/export')
  export(@CurrentAuth() auth: AuthContext): Promise<AccountExport> {
    return this.account.export(auth);
  }

  @Get('me/privacy')
  privacy(@CurrentAuth() auth: AuthContext): Promise<PrivacyState> {
    return this.account.privacy(auth);
  }

  @Put('me/privacy/notice')
  @HttpCode(HttpStatus.OK)
  readNotice(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(noticeReadSchema)) body: NoticeRead,
  ): Promise<PrivacyState> {
    return this.account.readNotice(auth, body.version);
  }

  @Put('me/privacy/history')
  @HttpCode(HttpStatus.OK)
  historyConsent(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(historyConsentSchema)) body: HistoryConsent,
  ): Promise<PrivacyState> {
    return this.account.setHistoryConsent(auth, body);
  }
}
