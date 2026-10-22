import {
  Controller,
  Get,
  Header,
  Headers,
  HttpStatus,
  Inject,
  Param,
  Req,
  Res,
} from '@nestjs/common';
import { inviteTokenSchema } from '@bargu/schemas';
import type { FastifyReply } from 'fastify';

import { ClientLimits } from '../auth/client-limits.js';
import { type AuthedRequest, Public } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { ENV } from '../config/config.module.js';
import { type Env, inviteHostOf } from '../config/env.js';
import { INVITE_CARD_PNG_BASE64 } from './invite-card.js';
import {
  INVITE_CARD_PATH,
  INVITE_PAGE_HEADERS,
  type InviteLanguage,
  pickInviteLanguage,
  renderInvitePages,
} from './invite-page.js';

/**
 * The page an invite link opens in a browser, and the card image its tags point to (docs/ADR/0009
 * Ek and Ek 2, 2026-10-22). Public: whoever holds a link may open it, signed in or not.
 *
 * Shared links carry the token in the FRAGMENT (`/i#<token>`, `/g#<token>`): a fragment never goes
 * in an HTTP request, so this server, the proxy and the link-preview crawlers never see it. The page
 * therefore has nothing to read, and has no script to read it either. Links of the earlier form
 * (`/i/<token>`, the token in the path) still open the same page.
 *
 * Every well-formed token gets the same page, byte for byte and in the same time: nothing here
 * reads the database or looks the token up, so a link's page says nothing about the link (it exists,
 * works, has expired, was used). The token's shape is public (43 characters of base64url) and
 * anything else is a plain 404. The page without a token is the same page.
 */
@Controller()
@Public()
export class InvitePageController {
  private readonly pages: Record<InviteLanguage, string>;
  private readonly card = Buffer.from(INVITE_CARD_PNG_BASE64, 'base64');

  constructor(
    @Inject(ENV) env: Env,
    private readonly limits: ClientLimits,
  ) {
    this.pages = renderInvitePages(inviteHostOf(env));
  }

  /**
   * What shared links open: an invite (`/i`: a friend, a circle, an event) or a guardian request
   * (`/g`). The token is in the fragment, which is not part of the request.
   */
  @Get(['i', 'g'])
  fragmentPage(
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    return this.serve(acceptLanguage, request, reply);
  }

  /** The earlier form, still served: `/i/<token>` and `/g/<token>`, the token in the path. */
  @Get(['i/:token', 'g/:token'])
  page(
    @Param('token') token: string,
    @Headers('accept-language') acceptLanguage: string | undefined,
    @Req() request: AuthedRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<string> {
    if (!inviteTokenSchema.safeParse(token).success) {
      throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    }
    return this.serve(acceptLanguage, request, reply);
  }

  /**
   * The page's headers go on only to the page itself (not with @Header, which sets them before the
   * handler runs): a 404 or a 429 is the API's JSON error and must not be cacheable as a page.
   */
  private async serve(
    acceptLanguage: string | undefined,
    request: AuthedRequest,
    reply: FastifyReply,
  ): Promise<string> {
    // Per network, whatever the token (never a different answer for a token that exists).
    await this.limits.enforce('invitePage', request.ip);
    void reply.headers(INVITE_PAGE_HEADERS);
    return this.pages[pickInviteLanguage(acceptLanguage)];
  }

  /** The one generic image of every invite card: no name, photo or circle. */
  @Get(INVITE_CARD_PATH.slice(1))
  @Header('content-type', 'image/png')
  @Header('cache-control', 'public, max-age=86400')
  // Helmet's default would be same-origin; the card is meant to be fetched by other sites' previews.
  @Header('cross-origin-resource-policy', 'cross-origin')
  image(): Buffer {
    return this.card;
  }
}
