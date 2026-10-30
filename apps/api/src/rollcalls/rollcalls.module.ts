import { Module } from '@nestjs/common';

import { PushModule } from '../push/push.module.js';
import { RollcallsController } from './rollcalls.controller.js';
import { RollcallsService } from './rollcalls.service.js';

/** Event roll calls, "Herkes yerinde mi?" (docs/ADR/0040). */
@Module({
  imports: [PushModule],
  controllers: [RollcallsController],
  providers: [RollcallsService],
})
export class RollcallsModule {}
