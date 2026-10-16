import { type DynamicModule, Module } from '@nestjs/common';

import { KeysModule } from './auth/keys.module.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { EmailWorker } from './jobs/email.worker.js';
import { JobsModule } from './jobs/jobs.module.js';
import { Mailer } from './jobs/mailer.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { PushTokens } from './push/push-tokens.js';
import { PushWorker } from './push/push.worker.js';
import { WeatherWorker } from './weather/weather.worker.js';
import { EventExpiry } from './circles/event-expiry.js';
import { EventSweeper } from './circles/event-sweeper.js';
import { EventsService } from './events/events.service.js';
import { HistorySweeper } from './history/history-sweeper.js';
import { AccountPurge } from './account/account-purge.js';
import { AccountSweeper } from './account/account-sweeper.js';
import { GuardianSweeper } from './guardians/guardian-sweeper.js';
import { PlanEvents } from './billing/plan-events.js';
import { MeetingSweeper } from './docs/meeting-sweeper.js';
import { PlanSweeper } from './billing/plan-sweeper.js';

/** The background worker process: runs jobs and maintains the queues. No HTTP. */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [
        ConfigModule.forRoot(env),
        DatabaseModule,
        RedisModule,
        KeysModule,
        JobsModule.forRole({ supervise: true }),
      ],
      providers: [
        Mailer,
        EmailWorker,
        PushTokens,
        PushWorker,
        WeatherWorker,
        EventsService,
        EventExpiry,
        EventSweeper,
        HistorySweeper,
        AccountPurge,
        AccountSweeper,
        GuardianSweeper,
        PlanEvents,
        PlanSweeper,
        MeetingSweeper,
      ],
    };
  }
}
