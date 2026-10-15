import { Body, Controller, Get, Header, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  type WebChallenge,
  type WebCodeRequest,
  webCodeRequestSchema,
  type WebCodeVerify,
  webCodeVerifySchema,
  type WebRevoke,
  webRevokeSchema,
  type WebSession,
} from '@bargu/schemas';

import { ZodPipe } from '../common/zod.pipe.js';
import { type AuthedRequest, Public, Unsigned } from './request-context.js';
import { WebAccountService } from './web-account.service.js';
import { WEB_PAGE_CSP, WEB_PAGE_CSS, WEB_PAGE_HTML, WEB_PAGE_JS } from './web-page.js';

/**
 * The account web page and its three steps (docs/ADR/0021). Public: whoever uses it has no phone
 * to sign with; its own code, binding and budgets guard it. Same-origin only (the page's own
 * script; cross-site browser requests are refused by the CSRF protection).
 */
@Controller()
@Public()
export class WebAccountController {
  constructor(private readonly web: WebAccountService) {}

  @Get('hesap')
  @Header('content-type', 'text/html; charset=utf-8')
  @Header('content-security-policy', WEB_PAGE_CSP)
  @Header('cache-control', 'no-store')
  @Header('referrer-policy', 'no-referrer')
  @Header('x-robots-tag', 'noindex')
  page(): string {
    return WEB_PAGE_HTML;
  }

  @Get('hesap/app.js')
  @Header('content-type', 'text/javascript; charset=utf-8')
  @Header('cache-control', 'no-cache')
  script(): string {
    return WEB_PAGE_JS;
  }

  @Get('hesap/app.css')
  @Header('content-type', 'text/css; charset=utf-8')
  @Header('cache-control', 'no-cache')
  style(): string {
    return WEB_PAGE_CSS;
  }

  /** Sends a code (an account gets an email); the same answer for every address. */
  @Post('v1/web/code')
  @Unsigned()
  @HttpCode(HttpStatus.ACCEPTED)
  code(
    @Body(new ZodPipe(webCodeRequestSchema)) body: WebCodeRequest,
    @Req() request: AuthedRequest,
  ): Promise<WebChallenge> {
    return this.web.requestCode(body, request.ip);
  }

  @Post('v1/web/verify')
  @Unsigned()
  @HttpCode(HttpStatus.OK)
  verify(
    @Body(new ZodPipe(webCodeVerifySchema)) body: WebCodeVerify,
    @Req() request: AuthedRequest,
  ): Promise<WebSession> {
    return this.web.verify(body, request.ip);
  }

  @Post('v1/web/revoke-device')
  @Unsigned()
  @HttpCode(HttpStatus.OK)
  revoke(
    @Body(new ZodPipe(webRevokeSchema)) body: WebRevoke,
    @Req() request: AuthedRequest,
  ): Promise<{ revoked: boolean }> {
    return this.web.revokeDevice(body, request.ip);
  }
}
