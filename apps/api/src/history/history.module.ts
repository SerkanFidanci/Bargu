import { Module } from '@nestjs/common';

import { HistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';

/** End-to-end encrypted location history, kept two weeks (docs/ADR/0019). */
@Module({
  controllers: [HistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
