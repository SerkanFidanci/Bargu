import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { EventsGateway } from './events.gateway.js';
import { EventsService } from './events.service.js';

/** Live events to phones (BARGU_PLAN §3.4); any module publishes through EventsService. */
@Global()
@Module({
  imports: [AuthModule],
  providers: [EventsService, EventsGateway],
  exports: [EventsService],
})
export class EventsModule {}
