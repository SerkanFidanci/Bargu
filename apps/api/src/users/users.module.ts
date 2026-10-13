import { Module } from '@nestjs/common';

import { CirclesModule } from '../circles/circles.module.js';
import { MeController } from './me.controller.js';
import { ProfileService } from './profile.service.js';

@Module({
  imports: [CirclesModule],
  controllers: [MeController],
  providers: [ProfileService],
})
export class UsersModule {}
