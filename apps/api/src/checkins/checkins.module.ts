import { Module } from '@nestjs/common';

import { CheckinsController } from './checkins.controller.js';
import { CheckinsService } from './checkins.service.js';

/** Arrival checks, the sealed escrow (docs/ADR/0039); the worker fires them (checkin-worker.ts). */
@Module({
  controllers: [CheckinsController],
  providers: [CheckinsService],
})
export class CheckinsModule {}
