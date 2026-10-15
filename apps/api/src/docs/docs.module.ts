import { Module } from '@nestjs/common';

import { DocsController } from './docs.controller.js';
import { DocsService } from './docs.service.js';

/** End-to-end encrypted documents of event circles: meeting, polls, votes (docs/ADR/0018). */
@Module({
  controllers: [DocsController],
  providers: [DocsService],
})
export class DocsModule {}
