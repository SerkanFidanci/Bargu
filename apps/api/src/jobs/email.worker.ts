import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { deriveOtpCode, deriveWebCode } from '@bargu/crypto';
import type { Job, JobResult, PgBoss } from 'pg-boss';

import { AuthKeys } from '../auth/auth-keys.js';
import { type EmailJob, EmailJobs } from './email-jobs.js';
import { Mailer } from './mailer.js';
import { otpEmail, webCodeEmail } from './otp-email.js';
import { QUEUES } from './queues.js';
import { JOB_QUEUE } from './tokens.js';

/** Jobs taken per fetch; while fetches come back full the worker keeps going without a pause. */
export const EMAIL_BATCH_SIZE = 20;

/**
 * Sends queued emails. Each job settles on its own: a failed send is retried with backoff and ends
 * in the dead-letter queue; a payload that can never be opened goes there at once.
 */
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
    await this.boss.work(
      QUEUES.email,
      {
        batchSize: EMAIL_BATCH_SIZE,
        // Drain a backlog continuously instead of pausing between batches.
        burstWhenBatchFull: true,
        perJobResults: true,
        // NOTIFY wakes the worker at once; if a notification is ever missed, a login code still
        // leaves within two seconds instead of the 30 s default backstop.
        pollingIntervalSeconds: 1,
        notifyPollingIntervalSeconds: 2,
      },
      (batch) => Promise.all(batch.map((job) => this.handle(job))),
    );
  }

  private async handle(job: Job<unknown>): Promise<JobResult> {
    let email: EmailJob;
    try {
      email = this.jobs.open(job.data);
    } catch {
      // Sealed under another key (rotated) or malformed: no retry can ever open it.
      this.logger.warn(`dead-lettered ${job.id}: payload cannot be opened`);
      return { id: job.id, status: 'deadletter' };
    }
    try {
      await this.mailer.send(
        email.kind === 'web'
          ? webCodeEmail(email.to, email.locale, deriveWebCode(this.keys.otpKey, email.challengeId))
          : otpEmail(email.to, email.locale, deriveOtpCode(this.keys.otpKey, email.challengeId)),
      );
    } catch (error) {
      // Job id and error type only: never the address or the code.
      this.logger.warn(
        `send failed for ${job.id}: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return { id: job.id, status: 'failed' };
    }
    this.logger.log(`sent ${job.id}`);
    return { id: job.id, status: 'completed' };
  }
}
