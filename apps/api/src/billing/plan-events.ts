import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { REDIS, type RedisClient } from '../infra/redis/redis.client.js';
import { locationKey } from '../relay/relay.service.js';

/** Row of app.circles_openness_of (migrations/0028). */
interface OpennessRow extends Record<string, unknown> {
  circle_id: string;
  epoch: number;
  open: boolean;
  members: string[];
}

/**
 * Someone's Bargu+ changed (bought, renewed, ran out, refunded; docs/ADR/0024 §2): every circle
 * they are active in hears it, so its members fetch it again and see whether it is paused (no
 * polling). A circle nobody keeps open loses its last locations at once: nobody sees a frozen dot.
 * The account itself hears that its plan changed. Used by the API and the worker.
 */
@Injectable()
export class PlanEvents {
  constructor(
    private readonly database: DatabaseService,
    private readonly events: EventsService,
    @Inject(REDIS) private readonly redis: RedisClient,
  ) {}

  /** Whether each of the account's circles is open now, to compare after a change. */
  async openness(userId: string): Promise<Map<string, boolean>> {
    const rows = await this.rows(userId);
    return new Map(rows.map((row) => [row.circle_id, row.open]));
  }

  /**
   * Tells the circles whose openness changed: from `before` (taken just before the change), or
   * without it (a plan ran out with time, which can only close) the circles closed now. A renewal
   * or a cancellation that opens or closes nothing tells nobody else (QA 19 P3: in a pair it named
   * who did it). The account itself always hears that its plan changed.
   */
  async changed(userId: string, before?: Map<string, boolean>): Promise<void> {
    for (const row of await this.rows(userId)) {
      const flipped = before === undefined ? !row.open : before.get(row.circle_id) !== row.open;
      if (!flipped) continue;
      if (!row.open) await this.redis.del(locationKey(row.circle_id));
      await this.events.publish(row.members, {
        type: 'circle.changed',
        circleId: row.circle_id,
        epoch: row.epoch,
      });
    }
    await this.events.publish([userId], { type: 'plan.changed' });
  }

  /** Only the account hears that its plan changed (a parent answered its purchase request). */
  async own(userId: string): Promise<void> {
    await this.events.publish([userId], { type: 'plan.changed' });
  }

  /** Outside any session (the function answers none, migration 0029). */
  private async rows(userId: string): Promise<OpennessRow[]> {
    const result = await this.database.db.execute<OpennessRow>(
      sql`SELECT * FROM app.circles_openness_of(${userId})`,
    );
    return result.rows;
  }
}
