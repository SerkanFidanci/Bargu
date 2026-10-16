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

  async changed(userId: string): Promise<void> {
    const result = await this.database.db.execute<OpennessRow>(
      sql`SELECT * FROM app.circles_openness_of(${userId})`,
    );
    for (const row of result.rows) {
      if (!row.open) await this.redis.del(locationKey(row.circle_id));
      await this.events.publish(row.members, {
        type: 'circle.changed',
        circleId: row.circle_id,
        epoch: row.epoch,
      });
    }
    await this.events.publish([userId], { type: 'plan.changed' });
  }
}
