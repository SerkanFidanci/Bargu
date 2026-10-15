import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DevicePushes, PUSH_NOTICES, type PushNotice, sealedPushSchema } from '@bargu/schemas';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { QUEUES } from '../jobs/queues.js';
import { JOB_QUEUE } from '../jobs/tokens.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';

/**
 * A queued notification (docs/ADR/0016). `notice`: news the server announces itself (it seals
 * kind and circle for the device when sending). `sealed`: a member's phone sealed it for one
 * device; the server only carries it, if that device is still the user's current one.
 */
export const pushJobSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('notice'),
      userId: z.uuid(),
      notice: z.enum(PUSH_NOTICES),
      circleId: z.uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal('sealed'),
      userId: z.uuid(),
      deviceId: z.uuid(),
      sealed: sealedPushSchema,
    })
    .strict(),
]);
export type PushJob = z.infer<typeof pushJobSchema>;

/** The same news about the same circle reaches a phone at most once a minute. */
export const PUSH_THROTTLE_SECONDS = 60;
/**
 * Guardian notices others can cause (a request to approve, someone new near the child) reach a
 * parent at most this often an hour, however many accounts cause them (QA 5b/5c S-3).
 */
export const GUARDIAN_NOTICES_PER_HOUR = 30;

/**
 * Queues push notifications for people who should hear about something (the worker sends them).
 * Never blocks or fails the action that caused it; off entirely when push is not configured.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger('Notifier');
  private readonly enabled: boolean;

  constructor(
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
    @Inject(ENV) env: Env,
    private readonly limiter: RateLimiter,
  ) {
    this.enabled = env.FCM_SERVICE_ACCOUNT !== undefined || env.APNS_KEY !== undefined;
  }

  async notify(userIds: Iterable<string>, notice: PushNotice, circleId: string): Promise<void> {
    for (const userId of new Set(userIds)) {
      await this.queue(
        { type: 'notice', userId, notice, circleId },
        `${userId}:${notice}:${circleId}`,
      );
    }
  }

  /**
   * A guardian notice others can cause, within each parent's hourly allowance; beyond it the
   * parent still sees it on the shared view (the event), just not as a notification.
   */
  async notifyGuardians(
    guardianIds: Iterable<string>,
    notice: PushNotice,
    subjectId: string,
  ): Promise<void> {
    for (const guardianId of new Set(guardianIds)) {
      const allowed = await this.limiter.hit(
        `guardian-notices:${guardianId}`,
        GUARDIAN_NOTICES_PER_HOUR,
        3600,
      );
      if (allowed.allowed) await this.notify([guardianId], notice, subjectId);
    }
  }

  /** Sealed notifications a member's phone made for others (already checked to be offline members). */
  async forward(pushes: DevicePushes): Promise<void> {
    for (const { userId, deviceId, sealed } of pushes) {
      await this.queue({ type: 'sealed', userId, deviceId, sealed }, null);
    }
  }

  private async queue(job: PushJob, singletonKey: string | null): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.boss.send(
        QUEUES.push,
        job,
        singletonKey === null ? {} : { singletonKey, singletonSeconds: PUSH_THROTTLE_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`push not queued: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}
