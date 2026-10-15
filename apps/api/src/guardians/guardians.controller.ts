import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import {
  type GuardianCode,
  type GuardianEnd,
  type GuardianLink,
  type GuardianPreview,
  guardianTokenBodySchema,
  type GuardianView,
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

  @Get(':id')
  view(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<GuardianView> {
    return this.guardians.view(auth, id);
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
