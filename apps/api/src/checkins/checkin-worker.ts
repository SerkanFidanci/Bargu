import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { PgBoss } from 'pg-boss';
import { z } from 'zod';

import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { QUEUES } from '../jobs/queues.js';
import { JOB_QUEUE } from '../jobs/tokens.js';
import { Notifier } from '../push/notifier.js';

/** How often the worker looks for checks past their time that no job fired (it was down). */
const CATCH_UP_MS = 60_000;

const jobSchema = z.object({ id: z.uuid() }).strict();

/**
 * Fires arrival checks at their time (docs/ADR/0039 §5), in the worker. A job carries a check's id
 * and nothing else. Firing (migration 0045 app.fire_checkin) drops the boxes of recipients who may
 * no longer get it, marks it fired and names who to tell: the recipients get a durable
 * `checkin.fired` event and a server notice that says nothing but which check, then fetch their own
 * sealed alert; the owner gets the event too. A check cancelled, fired, or moved later fires
 * nothing. Checks a job missed (the worker was down) fire at the next round.
 */
@Injectable()
export class CheckinWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('CheckinWorker');
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly database: DatabaseService,
    @Inject(JOB_QUEUE) private readonly boss: PgBoss,
    private readonly events: EventsService,
    private readonly notifier: Notifier,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.boss.work(
      QUEUES.checkinFire,
      { batchSize: 5, pollingIntervalSeconds: 2 },
      async (jobs) => {
        for (const job of jobs) {
          const parsed = jobSchema.safeParse(job.data);
          if (parsed.success) await this.fire(parsed.data.id);
        }
      },
    );
    void this.catchUp();
    this.timer = setInterval(() => void this.catchUp(), CATCH_UP_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  /** Fires one check if it is due; returns how many recipients were told (null: nothing fired). */
  async fire(id: string): Promise<number | null> {
    const rows = (
      await this.database.db.execute<{
        owner_id: string;
        recipient_id: string | null;
        device_id: string | null;
      }>(sql`SELECT owner_id, recipient_id, device_id FROM app.fire_checkin(${id}::uuid)`)
    ).rows;
    const owner = rows[0]?.owner_id;
    if (owner === undefined) return null;
    const recipients = rows.flatMap((row) => (row.recipient_id === null ? [] : [row.recipient_id]));
    await this.events.publish([owner, ...recipients], {
      type: 'checkin.fired',
      checkinId: id,
      ownerId: owner,
    });
    await this.notifier.notify(recipients, 'checkin', id);
    return recipients.length;
  }

  /** Checks past their time with no job behind them: fired now. */
  async catchUp(): Promise<void> {
    try {
      const overdue = (
        await this.database.db.execute<{ id: string }>(sql`SELECT app.overdue_checkins() AS id`)
      ).rows;
      for (const { id } of overdue) await this.fire(id);
    } catch (error) {
      this.logger.warn(`catch-up: ${error instanceof Error ? error.name : 'unknown'}`);
    }
  }
}
