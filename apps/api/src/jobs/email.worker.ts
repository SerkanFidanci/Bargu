import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { deriveOtpCode } from '@bargu/crypto';
import type { PgBoss } from 'pg-boss';

import { AuthKeys } from '../auth/auth-keys.js';
import { type EmailJob, EmailJobs } from './email-jobs.js';
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
    const options = {
      localConcurrency: 4,
      // NOTIFY wakes the worker at once; if a notification is ever missed, a login code still
      // leaves within two seconds instead of the 30 s default backstop.
      pollingIntervalSeconds: 1,
      notifyPollingIntervalSeconds: 2,
    };
    await this.boss.work(QUEUES.email, options, async ([job]) => {
      if (job === undefined) return;
      let email: EmailJob;
      try {
        email = this.jobs.open(job.data);
      } catch {
        // Sealed under another key (rotated) or malformed: no retry can ever open it, and a backlog
        // of such jobs would delay real codes. Drop it; the user simply asks for a new code.
        this.logger.warn(`dropped ${job.id}: payload cannot be opened`);
        return;
      }
      const code = deriveOtpCode(this.keys.otpKey, email.challengeId);
      await this.mailer.send(otpEmail(email.to, email.locale, code));
      // Job id only: never the address or the code.
      this.logger.log(`sent ${job.id}`);
    });
  }
}
