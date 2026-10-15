import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  type Circle,
  type CircleCreate,
  circleCreateSchema,
  circleRenameSchema,
  type Invite,
  type InviteCreate,
  inviteCreateSchema,
  type InvitePreview,
  inviteTokenBodySchema,
  type KeyUpload,
  keyUploadSchema,
  profileQuerySchema,
  type PublicProfile,
  type SenderKeyDistribution,
  usernameBodySchema,
} from '@bargu/schemas';
import { z } from 'zod';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { CirclesService } from './circles.service.js';
import { EventExpiry } from './event-expiry.js';
import { InvitesService } from './invites.service.js';
import { KeysService } from './keys.service.js';
import { ProfilesService } from './profiles.service.js';

const idPipe = new ZodPipe(z.uuid());

/**
 * Circles, friends, invites and sender keys (Faz 4). Every route needs a session; every POST/PATCH
 * is device-signed (global guards). What a caller may see or change is enforced by row-level
 * security underneath, not only here.
 */
@Controller('v1')
export class CirclesController {
  constructor(
    private readonly circles: CirclesService,
    private readonly invites: InvitesService,
    private readonly keys: KeysService,
    private readonly profiles: ProfilesService,
    private readonly expiry: EventExpiry,
  ) {}

  @Get('circles')
  async list(@CurrentAuth() auth: AuthContext): Promise<{ circles: Circle[] }> {
    return { circles: await this.circles.list(auth) };
  }

  @Post('circles')
  create(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(circleCreateSchema)) body: CircleCreate,
  ): Promise<Circle> {
    return this.circles.create(auth, body);
  }

  @Get('circles/:id')
  get(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<Circle> {
    return this.circles.get(auth, id);
  }

  @Patch('circles/:id')
  rename(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodPipe(circleRenameSchema)) body: { name: string },
  ): Promise<Circle> {
    return this.circles.rename(auth, id, body.name);
  }

  @Post('circles/:id/accept')
  @HttpCode(HttpStatus.OK)
  accept(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<Circle> {
    return this.circles.accept(auth, id);
  }

  @Post('circles/:id/decline')
  @HttpCode(HttpStatus.NO_CONTENT)
  decline(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<void> {
    return this.circles.decline(auth, id);
  }

  @Post('circles/:id/leave')
  @HttpCode(HttpStatus.NO_CONTENT)
  leave(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<void> {
    return this.circles.leave(auth, id);
  }

  /** The owner ends an event circle now: deleted with everything in it (docs/ADR/0017). */
  @Post('circles/:id/end')
  @HttpCode(HttpStatus.NO_CONTENT)
  end(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<void> {
    return this.expiry.endNow(auth, id);
  }

  @Post('circles/:id/rekey')
  @HttpCode(HttpStatus.OK)
  rekey(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<Circle> {
    return this.circles.rekey(auth, id);
  }

  @Post('circles/:id/members')
  @HttpCode(HttpStatus.OK)
  invite(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodPipe(usernameBodySchema)) body: { username: string },
  ): Promise<Circle> {
    return this.circles.inviteUser(auth, id, body.username);
  }

  @Post('circles/:id/members/:userId/remove')
  @HttpCode(HttpStatus.OK)
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Param('userId', idPipe) userId: string,
  ): Promise<Circle> {
    return this.circles.remove(auth, id, userId);
  }

  @Post('circles/:id/keys')
  @HttpCode(HttpStatus.NO_CONTENT)
  uploadKeys(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodPipe(keyUploadSchema)) body: KeyUpload,
  ): Promise<void> {
    return this.keys.upload(auth, id, body);
  }

  @Get('circles/:id/keys')
  async listKeys(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ distributions: SenderKeyDistribution[] }> {
    return { distributions: await this.keys.list(auth, id) };
  }

  /** Friend request by username (a pair circle the other side must accept). */
  @Post('friends')
  @HttpCode(HttpStatus.OK)
  requestFriend(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(usernameBodySchema)) body: { username: string },
  ): Promise<Circle> {
    return this.circles.requestFriend(auth, body.username);
  }

  /** Public card of a username before adding them: name and avatar only. */
  @Get('profiles')
  profile(
    @CurrentAuth() auth: AuthContext,
    @Query(new ZodPipe(profileQuerySchema)) query: { username: string },
  ): Promise<PublicProfile> {
    return this.profiles.byUsername(auth, query.username);
  }

  @Post('invites')
  createInvite(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(inviteCreateSchema)) body: InviteCreate,
  ): Promise<Invite> {
    return this.invites.create(auth, body);
  }

  /** Token in the body, not the URL: URLs end up in logs. */
  @Post('invites/preview')
  @HttpCode(HttpStatus.OK)
  previewInvite(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(inviteTokenBodySchema)) body: { token: string },
  ): Promise<InvitePreview> {
    return this.invites.preview(auth, body.token);
  }

  @Post('invites/accept')
  @HttpCode(HttpStatus.OK)
  acceptInvite(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(inviteTokenBodySchema)) body: { token: string },
  ): Promise<{ circleId: string }> {
    return this.invites.accept(auth, body.token);
  }

  @Post('invites/:id/revoke')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeInvite(@CurrentAuth() auth: AuthContext, @Param('id', idPipe) id: string): Promise<void> {
    return this.invites.revoke(auth, id);
  }

  /** The owner revokes every open link of the circle (an event's QR codes, whoever made them). */
  @Post('circles/:id/invites/revoke')
  @HttpCode(HttpStatus.OK)
  revokeAllInvites(
    @CurrentAuth() auth: AuthContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ revoked: number }> {
    return this.invites.revokeAll(auth, id);
  }
}
