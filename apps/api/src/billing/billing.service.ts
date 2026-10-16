import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Plan, PlanRecords, PlusProduct, TestPurchase, TestSimulate } from '@bargu/schemas';
import { eq, sql } from 'drizzle-orm';

import { HOUR } from '../auth/client-limits.js';
import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { ENV } from '../config/config.module.js';
import { billingTestOn, type Env } from '../config/env.js';
import { entitlements, users } from '../db/schema.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { PlanEvents } from './plan-events.js';

const DAY_MS = 24 * 3600_000;
/** How long one paid period lasts (a test purchase; a store says its own). */
const PERIOD_MS: Record<PlusProduct, number> = {
  plus_month: 30 * DAY_MS,
  plus_year: 365 * DAY_MS,
};
/** A failed payment: the plan holds this long before it runs out (docs/ADR/0024 §3). */
export const GRACE_MS = 7 * DAY_MS;
/** Test purchases and simulations per account and hour. */
export const BILLING_TEST_LIMIT = 60;

type Row = typeof entitlements.$inferSelect;
const PLUS = new Set(['trial', 'plus_month', 'plus_year']);

/**
 * Whether a row gives Bargu+ at `now` (the same rule as app.plus_active, migrations/0030): a test
 * row only where test purchases are on.
 */
export function plusLive(row: Row, now: number, testCounts: boolean): boolean {
  if (!PLUS.has(row.product)) return false;
  if (row.source === 'test' && !testCounts) return false;
  if (row.state === 'grace') return (row.graceUntil?.getTime() ?? 0) > now;
  if (row.state === 'active' || row.state === 'canceled') {
    return (row.expiresAt?.getTime() ?? 0) > now;
  }
  return false;
}

const ms = (date: Date | null) => (date === null ? null : date.getTime());

/** A test row as a store would leave it. */
interface TestChange {
  state: Row['state'];
  expiresAt: Date | null;
  graceUntil: Date | null;
  autoRenew: boolean;
}

/** One of the caller's test rows (or its trial's end), through migration 0029's function. */
async function changeTest(tx: Tx, id: string, change: TestChange): Promise<void> {
  await tx.execute(
    sql`SELECT app.change_test_entitlement(${id}, ${change.state}, ${change.expiresAt},
         ${change.graceUntil}, ${change.autoRenew})`,
  );
}

/**
 * The account's plan and its test purchases (docs/ADR/0024). Test purchases and simulations exist
 * only where test billing is on (never in production: there they answer 404) and touch only the
 * caller's own test plan or trial, never a store's.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly database: DatabaseService,
    private readonly limiter: RateLimiter,
    private readonly planEvents: PlanEvents,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async plan(auth: AuthContext): Promise<Plan> {
    const testing = billingTestOn(this.env);
    // Without test purchases (production) a test row is nothing, as in the database (QA 20 P1b).
    const rows = (await this.rows(auth.userId)).filter((row) => testing || row.source !== 'test');
    const now = Date.now();
    // A paid plan before the trial; the one running longest first.
    const current = rows
      .filter((row) => plusLive(row, now, testing))
      .sort(
        (a, b) =>
          Number(b.product !== 'trial') - Number(a.product !== 'trial') ||
          (ms(b.expiresAt) ?? 0) - (ms(a.expiresAt) ?? 0),
      )[0];
    const trial = rows.find((row) => row.product === 'trial');
    return {
      plan: current === undefined ? 'free' : current.product === 'trial' ? 'trial' : 'plus',
      product:
        current === undefined ? null : (current.product as 'trial' | 'plus_month' | 'plus_year'),
      source: current?.source ?? null,
      expiresAt: current === undefined ? null : ms(current.expiresAt),
      autoRenew: current?.autoRenew ?? false,
      graceUntil: current?.state === 'grace' ? ms(current.graceUntil) : null,
      trialEndsAt: trial === undefined ? null : ms(trial.expiresAt),
      cosmetics: rows
        .filter((row) => row.product.startsWith('cosmetic:') && row.state === 'active')
        .map((row) => row.product.slice('cosmetic:'.length)),
      testBilling: testing,
    };
  }

  /** Everything the account ever had, oldest first, for its data copy. */
  async records(auth: AuthContext): Promise<PlanRecords> {
    const rows = await this.rows(auth.userId);
    return {
      records: rows
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())
        .map((row) => ({
          product: row.product,
          source: row.source,
          state: row.state,
          startsAt: row.startsAt.getTime(),
          expiresAt: ms(row.expiresAt),
          graceUntil: ms(row.graceUntil),
          autoRenew: row.autoRenew,
        })),
    };
  }

  async testPurchase(auth: AuthContext, input: TestPurchase): Promise<Plan> {
    await this.guard(auth);
    const now = new Date();
    const before = await this.planEvents.openness(auth.userId);
    const changedPlus = await this.database.asUser(auth.userId, async (tx) => {
      // 15-17: a purchase needs a parent's yes (docs/ADR/0023, 0024 §5), not given here yet.
      const [me] = await tx
        .select({ band: users.ageBand })
        .from(users)
        .where(eq(users.id, auth.userId));
      if (me?.band === '15-17') throw new ApiError(HttpStatus.FORBIDDEN, 'GUARDIAN_APPROVAL');
      const mine = await tx.select().from(entitlements).where(eq(entitlements.userId, auth.userId));
      // Written only through migration 0029's functions: source 'test', the caller's own rows.
      const add = (product: string, expiresAt: Date | null, autoRenew: boolean) =>
        tx.execute(sql`SELECT app.add_test_entitlement(${product}, ${expiresAt}, ${autoRenew})`);
      if (input.product.startsWith('cosmetic:')) {
        if (!mine.some((row) => row.product === input.product && row.state === 'active')) {
          await add(input.product, null, false);
        }
        return false;
      }
      const product = input.product as PlusProduct;
      const live = mine.filter(
        (row) => row.product !== 'trial' && plusLive(row, now.getTime(), true),
      );
      if (live.some((row) => row.source !== 'test')) {
        throw new ApiError(HttpStatus.CONFLICT, 'ALREADY_SUBSCRIBED');
      }
      // Switching between monthly and yearly: the test plan running now ends first.
      for (const row of live) {
        await changeTest(tx, row.id, {
          state: 'expired',
          expiresAt: now,
          graceUntil: null,
          autoRenew: false,
        });
      }
      await add(product, new Date(now.getTime() + PERIOD_MS[product]), true);
      return true;
    });
    if (changedPlus) await this.planEvents.changed(auth.userId, before);
    return this.plan(auth);
  }

  async simulate(auth: AuthContext, input: TestSimulate): Promise<Plan> {
    await this.guard(auth);
    const now = new Date();
    const before = await this.planEvents.openness(auth.userId);
    await this.database.asUser(auth.userId, async (tx) => {
      const mine = await tx.select().from(entitlements).where(eq(entitlements.userId, auth.userId));
      if (input.action === 'endTrial') {
        const trial = mine.find((row) => row.product === 'trial');
        if (trial === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
        await changeTest(tx, trial.id, {
          state: 'expired',
          expiresAt: now,
          graceUntil: null,
          autoRenew: false,
        });
        return;
      }
      // The caller's latest test plan; a store's plan is never touched here.
      const target = mine
        .filter(
          (row) =>
            row.source === 'test' && (row.product === 'plus_month' || row.product === 'plus_year'),
        )
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
      if (target === undefined) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      const period = PERIOD_MS[target.product as PlusProduct];
      const kept: TestChange = {
        state: target.state,
        expiresAt: target.expiresAt,
        graceUntil: target.graceUntil,
        autoRenew: target.autoRenew,
      };
      const change: TestChange =
        input.action === 'renew'
          ? {
              state: 'active',
              // As a store renews at the end of the period, with now as that end: one period
              // from now, never two (a test plan ends within a year, migration 0030).
              expiresAt: new Date(now.getTime() + period),
              graceUntil: null,
              autoRenew: true,
            }
          : input.action === 'cancel'
            ? { ...kept, state: 'canceled', autoRenew: false }
            : input.action === 'expire'
              ? { state: 'expired', expiresAt: now, graceUntil: null, autoRenew: false }
              : input.action === 'fail'
                ? { ...kept, state: 'grace', graceUntil: new Date(now.getTime() + GRACE_MS) }
                : input.action === 'recover'
                  ? {
                      ...kept,
                      state: 'active',
                      expiresAt: new Date(now.getTime() + period),
                      graceUntil: null,
                    }
                  : { state: 'refunded', expiresAt: now, graceUntil: null, autoRenew: false };
      await changeTest(tx, target.id, change);
    });
    await this.planEvents.changed(auth.userId, before);
    return this.plan(auth);
  }

  /** Test billing off: as if there were no such route. On: a few calls an hour. */
  private async guard(auth: AuthContext): Promise<void> {
    if (!billingTestOn(this.env)) throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
    const result = await this.limiter.hit(`billing-test:${auth.userId}`, BILLING_TEST_LIMIT, HOUR);
    if (!result.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', result.retryAfter);
    }
  }

  private rows(userId: string): Promise<Row[]> {
    return this.database.asUser(userId, (tx) =>
      tx.select().from(entitlements).where(eq(entitlements.userId, userId)),
    );
  }
}
