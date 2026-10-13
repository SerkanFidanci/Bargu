import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
} from '@nestjs/common';
import { PgBoss } from 'pg-boss';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { EmailJobs } from './email-jobs.js';
import { JOBS_SCHEMA } from './queues.js';
import { JOB_QUEUE, JOBS_ROLE } from './tokens.js';

export { JOB_QUEUE };

/** Which duties a process takes on: the API only enqueues, the worker also maintains the queues. */
export interface JobsRole {
  supervise: boolean;
}

function createBoss(env: Env, role: JobsRole): PgBoss {
  const logger = new Logger('Jobs');
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    application_name: role.supervise ? 'bargu-worker-jobs' : 'bargu-api-jobs',
    schema: JOBS_SCHEMA,
    max: 5,
    // Tables and queues are created by the migration step; the runtime role cannot do DDL.
    migrate: false,
    createSchema: false,
    supervise: role.supervise,
    schedule: role.supervise,
    // REINDEX needs table ownership; run it from the migration role if bloat ever matters.
    reindex: false,
    useListenNotify: role.supervise,
  });
  boss.on('error', (error: Error) => {
    logger.error(`Queue error: ${error.name}`);
  });
  return boss;
}

@Global()
@Module({})
export class JobsModule implements OnModuleInit, OnApplicationShutdown {
  static forRole(role: JobsRole) {
    return {
      module: JobsModule,
      providers: [
        { provide: JOBS_ROLE, useValue: role },
        { provide: JOB_QUEUE, inject: [ENV, JOBS_ROLE], useFactory: createBoss },
        EmailJobs,
      ],
      exports: [JOB_QUEUE, EmailJobs],
    };
  }

  constructor(@Inject(JOB_QUEUE) private readonly boss: PgBoss) {}

  async onModuleInit(): Promise<void> {
    await this.boss.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
