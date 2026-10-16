import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { PlanController, TestBillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { PlanEvents } from './plan-events.js';

/** Bargu+, the trial and test purchases (docs/ADR/0024). */
@Module({
  imports: [AuthModule],
  controllers: [PlanController, TestBillingController],
  providers: [BillingService, PlanEvents],
  exports: [PlanEvents],
})
export class BillingModule {}
