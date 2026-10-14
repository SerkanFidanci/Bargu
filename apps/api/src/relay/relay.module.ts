import { Module } from '@nestjs/common';

import { PushModule } from '../push/push.module.js';
import { BumpController } from './bump.controller.js';
import { ProfileController } from './profile.controller.js';
import { RelayController } from './relay.controller.js';
import { RelayGateway } from './relay.gateway.js';
import { RelayService } from './relay.service.js';
import { StatusController } from './status.controller.js';

/** The encrypted relay: locations (Faz 5, docs/ADR/0011), pokes and statuses (Faz 6). */
@Module({
  imports: [PushModule],
  controllers: [RelayController, StatusController, BumpController, ProfileController],
  providers: [RelayService, RelayGateway],
  exports: [RelayService],
})
export class RelayModule {}
