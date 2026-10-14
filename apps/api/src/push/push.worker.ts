import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import type { Job, JobResult, PgBoss } from 'pg-boss';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { parseServiceAccount } from '../infra/google/service-account.js';
import { QUEUES } from '../jobs/queues.js';
import { JOB_QUEUE } from '../jobs/tokens.js';
import { FcmClient, FcmRejected } from './fcm.js';
import { pushJobSchema } from './notifier.js';
import { PushTokens } from './push-tokens.js';
import { pushText } from './push-texts.js';

/**
 * Sends queued push notifications through FCM. The text says only what kind of thing happened;
 * a dead token is forgotten; transient failures are retried with backoff by the queue.
 */
@Injectable()
export class PushWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('PushWorker');
  private readonly fcm: FcmClient | null;

  constructor(
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
    @Inject(ENV) env: Env,
    private readonly tokens: PushTokens,
  ) {
    const account =
      env.FCM_SERVICE_ACCOUNT === undefined ? null : parseServiceAccount(env.FCM_SERVICE_ACCOUNT);
    this.fcm =
      account?.project_id === undefined
        ? null
        : new FcmClient({ ...account, project_id: account.project_id });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.fcm === null) {
      this.logger.log('push is off (no FCM_SERVICE_ACCOUNT)');
      return;
    }
    await this.boss.work(
      QUEUES.push,
      { batchSize: 10, perJobResults: true, pollingIntervalSeconds: 2 },
      (batch) => Promise.all(batch.map((job) => this.handle(job))),
    );
  }

  private async handle(job: Job<unknown>): Promise<JobResult> {
    const parsed = pushJobSchema.safeParse(job.data);
    if (!parsed.success || this.fcm === null) return { id: job.id, status: 'deadletter' };
    const { userId, kind, circleId } = parsed.data;
    try {
      const target = await this.tokens.targetOf(userId);
      // Not registered (no permission, or push not in that build): nothing to do.
      if (target === null) return { id: job.id, status: 'completed' };
      const result = await this.fcm.send({
        token: target.token,
        ...pushText(kind, target.locale),
        data: { kind, circleId },
        tag: `${kind}:${circleId}`,
      });
      if (result === 'unregistered') await this.tokens.remove(userId, target.deviceId);
      return { id: job.id, status: 'completed' };
    } catch (error) {
      // Job id and error type only: never a token or a user.
      this.logger.warn(`push ${job.id} failed: ${error instanceof Error ? error.name : 'unknown'}`);
      return { id: job.id, status: error instanceof FcmRejected ? 'deadletter' : 'failed' };
    }
  }
}
