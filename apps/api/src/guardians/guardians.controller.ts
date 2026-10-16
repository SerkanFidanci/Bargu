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
  type GuardianCode,
  type GuardianEnd,
  type GuardianLink,
  type GuardianPreview,
  type GuardianRules,
  type GuardianSettings,
  guardianSettingsSchema,
  guardianTokenBodySchema,
  type GuardianView,
  type UsageReport,
  usageReportSchema,
} from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { GuardiansService } from './guardians.service.js';

const idPipe = new ZodPipe(z.uuid());

/**
 * Guardians (docs/ADR/0023 §4). Every route needs a session, every POST is device-signed; only the
 * two sides of a link see or change it.
 */
@Controller('v1/guardians')
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get()
  async list(@CurrentAuth() auth: AuthContext): Promise<{ links: GuardianLink[] }> {
    return { links: await this.guardians.list(auth) };
  }

  /** The child (15-17) shows a code for a parent to take. */
  @Post('code')
  code(@CurrentAuth() auth: AuthContext): Promise<GuardianCode> {
    return this.guardians.code(auth);
  }

  /** Token in the body, not the URL: URLs end up in logs. */
  @Post('preview')
  @HttpCode(HttpStatus.OK)
  preview(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(guardianTokenBodySchema)) body: { token: string },
  ): Promise<GuardianPreview> {
    return this.guardians.preview(auth, body.token);
  }

  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(guardianTokenBodySchema)) body: { token: string },
  ): Promise<GuardianLink> {
    return this.guardians.accept(auth, body.token);
  }

  /** The child's own rules (docs/ADR/0023 §5), as the phone applies them. */
  @Get('rules')
  rules(@CurrentAuth() auth: AuthContext): Promise<GuardianRules> {
    return this.guardians.rules(auth);
  }

  /** The child's phone: minutes the app was open on a day. */
  @Put('usage')
  @HttpCode(HttpStatus.NO_CONTENT)
  usage(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(usageReportSchema)) body: UsageReport,
  ): Promise<void> {
    return this.guardians.recordUsage(auth, body);
  }

  @Put(':id/settings')
  @HttpCode(HttpStatus.OK)
  settings(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodPipe(guardianSettingsSchema)) body: GuardianSettings,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
  ): Promise<GuardianView> {
    return this.guardians.setSettings(auth, id, body, clientLevelOf(level));
  }

  @Post(':id/requests/:requestId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Param('requestId', idPipe) requestId: string,
  ): Promise<{ done: boolean }> {
    return this.guardians.answer(auth, id, requestId, true);
  }

  @Post(':id/requests/:requestId/decline')
  @HttpCode(HttpStatus.OK)
  decline(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Param('requestId', idPipe) requestId: string,
  ): Promise<{ done: boolean }> {
    return this.guardians.answer(auth, id, requestId, false);
  }

  /** What the app can read of it: the level it says (`x-bargu-client`, ADR 0024 §10). */
  @Get(':id')
  view(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Headers(CLIENT_LEVEL_HEADER) level: string | undefined,
  ): Promise<GuardianView> {
    return this.guardians.view(auth, id, clientLevelOf(level));
  }

  @Post(':id/confirm')
  @HttpCode(HttpStatus.OK)
  confirm(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<GuardianLink> {
    return this.guardians.confirm(auth, id);
  }

  @Post(':id/end')
  @HttpCode(HttpStatus.OK)
  end(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<GuardianEnd> {
    return this.guardians.end(auth, id);
  }
}
