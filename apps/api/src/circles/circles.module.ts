import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PushModule } from '../push/push.module.js';
import { RelayModule } from '../relay/relay.module.js';
import { CirclesController } from './circles.controller.js';
import { CirclesService } from './circles.service.js';
import { InvitesService } from './invites.service.js';
import { KeysService } from './keys.service.js';
import { ProfilesService } from './profiles.service.js';

/** Circles, friends, invites and sender-key distribution (Faz 4, docs/ADR/0009). */
@Module({
  imports: [AuthModule, PushModule, RelayModule],
  controllers: [CirclesController],
  providers: [CirclesService, InvitesService, KeysService, ProfilesService],
  exports: [CirclesService],
})
export class CirclesModule {}
