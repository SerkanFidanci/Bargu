import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import { CirclesModule } from '../circles/circles.module.js';
import { GuardiansModule } from '../guardians/guardians.module.js';
import { AccountPurge } from './account-purge.js';
import { AccountController } from './account.controller.js';
import { AccountService } from './account.service.js';
import { LegalController } from '../legal/legal.controller.js';

/** Deleting an account, its copy, and its KVKK records (docs/ADR/0022). */
@Module({
  imports: [AuthModule, CirclesModule, GuardiansModule],
  controllers: [AccountController, LegalController],
  providers: [AccountService, AccountPurge],
})
export class AccountModule {}
