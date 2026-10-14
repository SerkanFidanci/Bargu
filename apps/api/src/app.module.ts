import { type DynamicModule, Module } from '@nestjs/common';

import { AuthModule } from './auth/auth.module.js';
import { KeysModule } from './auth/keys.module.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { CirclesModule } from './circles/circles.module.js';
import { EventsModule } from './events/events.module.js';
import { DatabaseModule } from './infra/database/database.module.js';
import { RedisModule } from './infra/redis/redis.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { PushModule } from './push/push.module.js';
import { RelayModule } from './relay/relay.module.js';
import { UsersModule } from './users/users.module.js';
import { WeatherModule } from './weather/weather.module.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        DatabaseModule,
        RedisModule,
        KeysModule,
        // The API only enqueues; the worker process runs jobs and queue maintenance.
        JobsModule.forRole({ supervise: false }),
        HealthModule,
        AuthModule,
        EventsModule,
        UsersModule,
        CirclesModule,
        PushModule,
        RelayModule,
        WeatherModule,
      ],
    };
  }
}
