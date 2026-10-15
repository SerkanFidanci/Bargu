import { Body, Controller, Get, Patch, Query } from '@nestjs/common';
import {
  type Me,
  type SecurityEvent,
  type ProfileUpdate,
  profileUpdateSchema,
  type UsernameAvailability,
  usernameAvailabilityQuerySchema,
} from '@bargu/schemas';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ProfileService } from './profile.service.js';
import { SecurityEventsService } from './security-events.service.js';

@Controller('v1')
export class MeController {
  constructor(
    private readonly profile: ProfileService,
    private readonly security: SecurityEventsService,
  ) {}

  @Get('me')
  me(@CurrentAuth() auth: AuthContext): Promise<Me> {
    return this.profile.me(auth);
  }

  /** The account's security events, newest first (Faz 9). */
  @Get('me/security-events')
  async securityEvents(@CurrentAuth() auth: AuthContext): Promise<{ events: SecurityEvent[] }> {
    return { events: await this.security.list(auth) };
  }

  /** Onboarding and profile edits (device-signed like every mutation). */
  @Patch('me')
  update(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(profileUpdateSchema)) body: ProfileUpdate,
  ): Promise<Me> {
    return this.profile.update(auth, body);
  }

  /** Live check while a name is typed (debounced by the app, rate limited per account). */
  @Get('usernames/availability')
  usernameAvailability(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(usernameAvailabilityQuerySchema)) query: { username: string },
  ): Promise<UsernameAvailability> {
    return this.profile.usernameAvailability(auth, query.username);
  }
}
