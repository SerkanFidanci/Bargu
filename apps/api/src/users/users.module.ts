import { Module } from '@nestjs/common';

import { CirclesModule } from '../circles/circles.module.js';
import { MeController } from './me.controller.js';
import { ProfileService } from './profile.service.js';
import { SecurityEventsService } from './security-events.service.js';

@Module({
  imports: [CirclesModule],
  controllers: [MeController],
  providers: [ProfileService, SecurityEventsService],
})
export class UsersModule {}
