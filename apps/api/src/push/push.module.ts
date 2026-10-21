import { Module } from '@nestjs/common';

import { Notifier } from './notifier.js';
import { PushController } from './push.controller.js';
import { PushTokens } from './push-tokens.js';
import { WatchNotices } from './watch-notices.js';

/** API side of push: phones register their token; services queue notifications. */
@Module({
  controllers: [PushController],
  providers: [PushTokens, Notifier, WatchNotices],
  exports: [Notifier, PushTokens, WatchNotices],
})
export class PushModule {}
