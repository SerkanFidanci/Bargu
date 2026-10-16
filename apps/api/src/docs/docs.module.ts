import { Module } from '@nestjs/common';

import { PushModule } from '../push/push.module.js';

import { DocsController } from './docs.controller.js';
import { DocsService } from './docs.service.js';

/**
 * End-to-end encrypted documents: an event's meeting, polls and votes (docs/ADR/0018), any other
 * circle's meeting (docs/ADR/0026).
 */
@Module({
  imports: [PushModule],
  controllers: [DocsController],
  providers: [DocsService],
})
export class DocsModule {}
