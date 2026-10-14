import { Module } from '@nestjs/common';

import { RelayController } from './relay.controller.js';
import { RelayGateway } from './relay.gateway.js';
import { RelayService } from './relay.service.js';

/** The encrypted location relay (Faz 5, docs/ADR/0011). */
@Module({
  controllers: [RelayController],
  providers: [RelayService, RelayGateway],
  exports: [RelayService],
})
export class RelayModule {}
