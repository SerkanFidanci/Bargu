import { Inject, Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import { type NoticeSigner, noticePublicKey, sealPush } from '@bargu/crypto';
import type { Job, JobResult, PgBoss } from 'pg-boss';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { parseServiceAccount } from '../infra/google/service-account.js';
import { QUEUES } from '../jobs/queues.js';
import { JOB_QUEUE } from '../jobs/tokens.js';
import { ApnsClient, ApnsRejected } from './apns.js';
import { FcmClient, FcmRejected, type SendResult } from './fcm.js';
import { type PushJob, pushJobSchema } from './notifier.js';
import { type PushTarget, PushTokens } from './push-tokens.js';
import { placeholderText } from './push-texts.js';

/**
 * Sends queued notifications (docs/ADR/0016), always as a sealed box only the target device opens:
 * the server's own notices are sealed here (kind and circle), signed with the notice key for that
 * device (QA-28 B-1), members' notifications arrive sealed by their phone. Android gets them data-only through FCM, iPhones through APNs with a placeholder
 * the Notification Service Extension replaces. A dead token is forgotten; transient failures are
 * retried with backoff by the queue.
 */
@Injectable()
export class PushWorker implements OnApplicationBootstrap {
  private readonly logger = new Logger('PushWorker');
  private readonly fcm: FcmClient | null;
  private readonly apns: ApnsClient | null;
  /** NOTICE_SIGNING_KEY and its id: every server notice is signed with it; null: unsigned. */
  private readonly signer: NoticeSigner | null;

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
    this.apns =
      env.APNS_KEY === undefined || env.APNS_KEY_ID === undefined || env.APNS_TEAM_ID === undefined
        ? null
        : new ApnsClient({
            key: Buffer.from(env.APNS_KEY, 'base64').toString('utf8'),
            keyId: env.APNS_KEY_ID,
            teamId: env.APNS_TEAM_ID,
            topic: env.APNS_TOPIC,
            origin: `https://${env.APNS_HOST}`,
          });
    this.signer =
      env.NOTICE_SIGNING_KEY === undefined || env.NOTICE_SIGNING_KID === undefined
        ? null
        : { secretKey: env.NOTICE_SIGNING_KEY, kid: env.NOTICE_SIGNING_KID };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.fcm === null && this.apns === null) {
      this.logger.log('push is off (no FCM_SERVICE_ACCOUNT, no APNS_KEY)');
      return;
    }
    // Once, at start. The public key only (for the apps' EXPO_PUBLIC_NOTICE_KEYS), never the seed.
    if (this.signer === null) {
      this.logger.warn('server notices go unsigned (no NOTICE_SIGNING_KEY): new apps drop them');
    } else {
      const { kid, secretKey } = this.signer;
      this.logger.log(`server notices are signed: ${kid}:${noticePublicKey(secretKey)}`);
    }
    await this.boss.work(
      QUEUES.push,
      { batchSize: 10, perJobResults: true, pollingIntervalSeconds: 2 },
      (batch) => Promise.all(batch.map((job) => this.handle(job))),
    );
  }

  private async handle(job: Job<unknown>): Promise<JobResult> {
    const parsed = pushJobSchema.safeParse(job.data);
    if (!parsed.success) return { id: job.id, status: 'deadletter' };
    try {
      const target = await this.tokens.targetOf(parsed.data.userId);
      // Not registered (no permission, no push in that build), or sealed for a device the user
      // no longer uses: nothing to do.
      const sealed = target === null ? null : this.seal(parsed.data, target);
      if (target === null || sealed === null) return { id: job.id, status: 'completed' };
      const result = await this.send(target, sealed, ttlOf(parsed.data));
      if (result === 'unregistered') await this.tokens.remove(target.userId, target.deviceId);
      return { id: job.id, status: 'completed' };
    } catch (error) {
      // Job id and error type only: never a token, a user or a payload.
      this.logger.warn(`push ${job.id} failed: ${error instanceof Error ? error.name : 'unknown'}`);
      const final = error instanceof FcmRejected || error instanceof ApnsRejected;
      return { id: job.id, status: final ? 'deadletter' : 'failed' };
    }
  }

  /** The box this worker sends `target` for a job, or null when the job was for another device. */
  seal(job: PushJob, target: PushTarget): string | null {
    return sealedFor(job, target, this.signer);
  }

  private send(target: PushTarget, sealed: string, ttlSeconds?: number): Promise<SendResult> {
    if (target.platform === 'ios') {
      return this.apns === null
        ? Promise.resolve('sent')
        : this.apns.send({ token: target.token, ...placeholderText(target.locale), sealed });
    }
    return this.fcm === null
      ? Promise.resolve('sent')
      : this.fcm.send({
          token: target.token,
          sealed,
          ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
        });
  }
}

/** A `watch` signal older than this is of no use: Google drops it instead of delivering it late. */
export const WATCH_TTL_SECONDS = 120;

/** How long Google may keep this job's message for a phone that is off (default: an hour). */
export function ttlOf(job: PushJob): number | undefined {
  return job.type === 'notice' && job.notice === 'watch' ? WATCH_TTL_SECONDS : undefined;
}

/**
 * The sealed box for this target, or null when the job was meant for another device. A notice is
 * signed by `signer` for this very device (QA-28 B-1), unsigned when the server has no notice key.
 */
export function sealedFor(
  job: PushJob,
  target: PushTarget,
  signer: NoticeSigner | null,
  now = Date.now(),
): string | null {
  if (job.type === 'sealed') return job.deviceId === target.deviceId ? job.sealed : null;
  // The silent `watch` notice (docs/ADR/0028 step 3) is for Android only for now: an iPhone would
  // show the placeholder text for it, and a signal nobody should see must not light a screen.
  if (job.notice === 'watch' && target.platform !== 'android') return null;
  return sealPush({
    recipient: { deviceId: target.deviceId, dhKey: target.dhKey },
    sender: null,
    body: { kind: 'notice', notice: job.notice, circleId: job.circleId, ts: now },
    signer,
  });
}
