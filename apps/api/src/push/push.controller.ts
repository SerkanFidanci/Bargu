import { Body, Controller, Delete, HttpCode, HttpStatus, Put } from '@nestjs/common';
import { type PushRegistration, pushRegistrationSchema } from '@bargu/schemas';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { PushTokens } from './push-tokens.js';

/** This device's push token (signed requests, like every change). */
@Controller('v1/push')
export class PushController {
  constructor(private readonly tokens: PushTokens) {}

  @Put()
  @HttpCode(HttpStatus.NO_CONTENT)
  async register(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(pushRegistrationSchema)) body: PushRegistration,
  ): Promise<void> {
    await this.tokens.register(auth, body);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.tokens.remove(auth.userId, auth.deviceId);
  }
}
