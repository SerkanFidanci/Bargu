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
      providers: [Mailer, EmailWorker, PushTokens, PushWorker, WeatherWorker],
    };
  }
}
