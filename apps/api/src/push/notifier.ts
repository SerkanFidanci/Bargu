import { Inject, Injectable, Logger } from '@nestjs/common';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { QUEUES } from '../jobs/queues.js';
import { JOB_QUEUE } from '../jobs/tokens.js';
import { PUSH_KINDS, type PushKind } from './push-texts.js';

export const pushJobSchema = z
  .object({ userId: z.uuid(), kind: z.enum(PUSH_KINDS), circleId: z.uuid() })
  .strict();
export type PushJob = z.infer<typeof pushJobSchema>;

/** The same news about the same circle reaches a phone at most once a minute. */
export const PUSH_THROTTLE_SECONDS = 60;

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
  ) {
    this.enabled = env.FCM_SERVICE_ACCOUNT !== undefined;
  }

  async notify(userIds: Iterable<string>, kind: PushKind, circleId: string): Promise<void> {
    if (!this.enabled) return;
    for (const userId of new Set(userIds)) {
      try {
        await this.boss.send(QUEUES.push, { userId, kind, circleId } satisfies PushJob, {
          singletonKey: `${userId}:${kind}:${circleId}`,
          singletonSeconds: PUSH_THROTTLE_SECONDS,
        });
      } catch (error) {
        this.logger.warn(`push not queued: ${error instanceof Error ? error.name : 'unknown'}`);
      }
    }
  }
}
