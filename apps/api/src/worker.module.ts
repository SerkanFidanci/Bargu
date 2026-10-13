import { type DynamicModule, Module } from '@nestjs/common';

import { KeysModule } from './auth/keys.module.js';
import { ConfigModule } from './config/config.module.js';
import type { Env } from './config/env.js';
import { EmailWorker } from './jobs/email.worker.js';
import { JobsModule } from './jobs/jobs.module.js';
import { Mailer } from './jobs/mailer.js';

/** The background worker process: runs jobs and maintains the queues. No HTTP. */
@Module({})
export class WorkerModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: WorkerModule,
      imports: [ConfigModule.forRoot(env), KeysModule, JobsModule.forRole({ supervise: true })],
      providers: [Mailer, EmailWorker],
    };
  }
}
