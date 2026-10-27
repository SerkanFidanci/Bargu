import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { deriveOtpCode, deriveWebCode, deriveWebUnlockToken } from '@bargu/crypto';
import type { Job, JobResult, PgBoss } from 'pg-boss';

import { AuthKeys } from '../auth/auth-keys.js';
import { ENV } from '../config/config.module.js';
import { type Env, webOriginOf } from '../config/env.js';
import { type EmailJob, EmailJobs } from './email-jobs.js';
import { Mailer, type OutgoingEmail } from './mailer.js';
import { opsEmail } from './ops-email.js';
import { otpEmail, webCodeEmail, webUnlockEmail } from './otp-email.js';
import { QUEUES } from './queues.js';
import { JOB_QUEUE } from './tokens.js';

/** Jobs taken per fetch; while fetches come back full the worker keeps going without a pause. */
export const EMAIL_BATCH_SIZE = 20;

/**
 * The email of a job, its code or secret derived now (never stored); null when it cannot be
 * written (a link with no web origin known).
 */
export function emailFor(
  email: EmailJob,
  otpKey: Uint8Array,
  origin: string | null,
): OutgoingEmail | null {
  if (email.kind === 'ops') return opsEmail(email);
  if (email.kind === 'otp') {
    return otpEmail(email.to, email.locale, deriveOtpCode(otpKey, email.challengeId));
  }
  if (email.kind === 'web') {
    return webCodeEmail(email.to, email.locale, deriveWebCode(otpKey, email.challengeId));
  }
  if (origin === null) return null;
  const secret = deriveWebUnlockToken(otpKey, email.challengeId);
  return webUnlockEmail(
    email.to,
    email.locale,
    `${origin}/hesap#unlock=${email.challengeId}.${secret}`,
  );
}

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
    @Inject(ENV) private readonly env: Env,
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
    const outgoing = emailFor(email, this.keys.otpKey, webOriginOf(this.env));
    if (outgoing === null) {
      this.logger.warn(`dead-lettered ${job.id}: no web origin for its link`);
      return { id: job.id, status: 'deadletter' };
    }
    try {
      await this.mailer.send(outgoing);
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
