import { Module } from '@nestjs/common';

import { HistoryController, MyHistoryController } from './history.controller.js';
import { HistoryService } from './history.service.js';

/** End-to-end encrypted location history, kept two weeks (docs/ADR/0019). */
@Module({
  controllers: [HistoryController, MyHistoryController],
  providers: [HistoryService],
})
export class HistoryModule {}
