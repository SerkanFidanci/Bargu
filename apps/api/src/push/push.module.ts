import { Module } from '@nestjs/common';

import { Notifier } from './notifier.js';
import { PushController } from './push.controller.js';
import { PushTokens } from './push-tokens.js';

/** API side of push: phones register their token; services queue notifications. */
@Module({
  controllers: [PushController],
  providers: [PushTokens, Notifier],
  exports: [Notifier, PushTokens],
})
export class PushModule {}
