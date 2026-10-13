import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { deriveOtpCode } from '@bargu/crypto';
import type { PgBoss } from 'pg-boss';

import { AuthKeys } from '../auth/auth-keys.js';
import { EmailJobs } from './email-jobs.js';
import { Mailer } from './mailer.js';
import { otpEmail } from './otp-email.js';
import { QUEUES } from './queues.js';
import { JOB_QUEUE } from './tokens.js';

/** Sends queued emails. Failures retry with backoff, then land in the dead-letter queue. */
@Injectable()
export class EmailWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('EmailWorker');

  constructor(
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
    private readonly jobs: EmailJobs,
    private readonly mailer: Mailer,
    private readonly keys: AuthKeys,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work(QUEUES.email, { localConcurrency: 4 }, async ([job]) => {
      if (job === undefined) return;
      const email = this.jobs.open(job.data);
      const code = deriveOtpCode(this.keys.otpKey, email.challengeId);
      await this.mailer.send(otpEmail(email.to, email.locale, code));
      // Job id only: never the address or the code.
      this.logger.log(`sent ${job.id}`);
    });
  }
}
