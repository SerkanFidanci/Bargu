import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  type CosmeticPassReply,
  type Plan,
  type PlanRecords,
  type TestPurchase,
  testPurchaseSchema,
  type TestSimulate,
  testSimulateSchema,
} from '@bargu/schemas';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { BillingService } from './billing.service.js';

/** The caller's own plan (docs/ADR/0024): nobody else's is ever shown. */
@Controller('v1/me/plan')
export class PlanController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  plan(@CurrentAuth() auth: AuthContext): Promise<Plan> {
    return this.billing.plan(auth);
  }

  /** Every plan and pack the account ever had, for its data copy (KVKK). */
  @Get('records')
  records(@CurrentAuth() auth: AuthContext): Promise<PlanRecords> {
    return this.billing.records(auth);
  }
}

/** The caller's own cosmetic pass (docs/ADR/0025): their packs, signed by the server. */
@Controller('v1/me/cosmetics')
export class CosmeticsController {
  constructor(private readonly billing: BillingService) {}

  @Get('pass')
  pass(@CurrentAuth() auth: AuthContext): Promise<CosmeticPassReply> {
    return this.billing.cosmeticPass(auth);
  }
}

/**
 * Test purchases (docs/ADR/0024 §6): a purchase with no payment, and what a store would do to the
 * plan. 404 wherever test billing is off, and always in production. Device-signed like every POST.
 */
@Controller('v1/billing/test')
export class TestBillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('purchase')
  @HttpCode(HttpStatus.OK)
  purchase(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(testPurchaseSchema)) body: TestPurchase,
  ): Promise<Plan> {
    return this.billing.testPurchase(auth, body);
  }

  @Post('simulate')
  @HttpCode(HttpStatus.OK)
  simulate(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(testSimulateSchema)) body: TestSimulate,
  ): Promise<Plan> {
    return this.billing.simulate(auth, body);
  }
}
