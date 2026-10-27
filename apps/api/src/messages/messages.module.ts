import { Module } from '@nestjs/common';

import { PushModule } from '../push/push.module.js';
import { MessagesController } from './messages.controller.js';
import { MessagesService } from './messages.service.js';

/** Messages and moments, end-to-end encrypted and gone after 24 hours (docs/ADR/0035). */
@Module({
  imports: [PushModule],
  controllers: [MessagesController],
  providers: [MessagesService],
})
export class MessagesModule {}
