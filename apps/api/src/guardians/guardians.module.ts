import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CirclesModule } from '../circles/circles.module.js';
import { PushModule } from '../push/push.module.js';
import { GuardiansController } from './guardians.controller.js';
import { GuardiansService } from './guardians.service.js';

/** Parents and children linked by mutual approval (docs/ADR/0023 §4). */
@Module({
  imports: [AuthModule, CirclesModule, PushModule],
  controllers: [GuardiansController],
  providers: [GuardiansService],
  exports: [GuardiansService],
})
export class GuardiansModule {}
