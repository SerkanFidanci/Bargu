import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { ENV } from '../config/config.module.js';
import { billingTestOn, type Env } from '../config/env.js';
import { DatabaseService } from '../infra/database/database.service.js';

/**
 * Whether test purchases work here (docs/ADR/0024 §6, QA 21 B-5). The database's setting is the
 * one truth (the migrator writes it from the deployment's); the API's own flag can only close
 * them. Its flag on and the database's off: off, so no plan counts a test row and no purchase
 * fails on a database that refuses it (404, as where they do not exist).
 */
@Injectable()
export class TestBilling {
  constructor(
    private readonly database: DatabaseService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async on(userId: string): Promise<boolean> {
    return billingTestOn(this.env) && (await this.inDatabase(userId));
  }

  /** The database's setting (migration 0030), read as the caller (migration 0034). */
  async inDatabase(userId: string): Promise<boolean> {
    const { rows } = await this.database.asUser(userId, (tx) =>
      tx.execute<{ on: boolean }>(sql`SELECT app.billing_test_on() AS on`),
    );
    return rows[0]?.on === true;
  }
}
