import { Inject, Injectable, Logger } from '@nestjs/common';
import { type DevicePushes, PUSH_NOTICES, type PushNotice, sealedPushSchema } from '@bargu/schemas';
import { sql } from 'drizzle-orm';
import type { PgBoss, SendOptions } from 'pg-boss';
import { z } from 'zod';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import type { Tx } from '../infra/database/database.service.js';
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

/**
 * The device each of these members of a circle is notified on: their current one, as the caller
 * sees the circle (app.circle_member_cards, in the caller's own session; a stranger sees none).
 */
export async function currentDevices(
  tx: Tx,
  circleId: string,
  userIds: Iterable<string>,
): Promise<Map<string, string>> {
  const wanted = new Set(userIds);
  if (wanted.size === 0) return new Map();
  const { rows } = await tx.execute<{ user_id: string; device_id: string | null }>(
    sql`SELECT user_id, device_id FROM app.circle_member_cards(${circleId}) WHERE status = 'active'`,
  );
  return new Map(
    rows.flatMap((row) =>
      wanted.has(row.user_id) && row.device_id !== null ? [[row.user_id, row.device_id]] : [],
    ),
  );
}

/** A queued `watch` notice not picked up by then is dropped: a signal that late is of no use. */
const WATCH_JOB_SECONDS = 60;

/** The same news about the same circle reaches a phone at most once a minute. */
const PUSH_THROTTLE_SECONDS = 60;
/**
 * Guardian notices others can cause (a request to approve, someone new near the child) reach a
 * parent at most this often an hour, however many accounts cause them (QA 5b/5c S-3).
 */
const GUARDIAN_NOTICES_PER_HOUR = 30;

/**
 * Queues push notifications for people who should hear about something (the worker sends them).
 * Never blocks or fails the action that caused it; off entirely when push is not configured.
 */
@Injectable()
export class Notifier {
  private readonly logger = new Logger('Notifier');
  /** Whether any push service is configured (else nothing is queued). */
  readonly enabled: boolean;

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

  /**
   * Sealed notifications a member's phone made for others, checked when they come in (QA 21 B-2):
   * only for `devices` (the members to tell, each with their current device, see currentDevices),
   * and one per device however many the phone sent. A notification for any other device (someone
   * else's, an old phone) is dropped, not queued; the action that brought it still goes through.
   */
  async forward(pushes: DevicePushes, devices: ReadonlyMap<string, string>): Promise<void> {
    const queued = new Set<string>();
    for (const { userId, deviceId, sealed } of pushes) {
      if (devices.get(userId) !== deviceId || queued.has(`${userId}:${deviceId}`)) continue;
      queued.add(`${userId}:${deviceId}`);
      await this.queue({ type: 'sealed', userId, deviceId, sealed }, null);
    }
  }

  /**
   * The silent `watch` notice (docs/ADR/0028 step 3): someone looks at this circle now. Its
   * allowance is the caller's (WatchNotices); here it is sent once and never retried, since a
   * signal that late is of no use (the phone would go live for nobody).
   */
  async notifyWatch(userId: string, circleId: string): Promise<void> {
    await this.queue({ type: 'notice', userId, notice: 'watch', circleId }, null, {
      retryLimit: 0,
      retentionSeconds: WATCH_JOB_SECONDS,
    });
  }

  private async queue(
    job: PushJob,
    singletonKey: string | null,
    options: SendOptions = {},
  ): Promise<void> {
    if (!this.enabled) return;
    try {
      await this.boss.send(
        QUEUES.push,
        job,
        singletonKey === null
          ? options
          : { ...options, singletonKey, singletonSeconds: PUSH_THROTTLE_SECONDS },
      );
    } catch (error) {
      this.logger.warn(`push not queued: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}
