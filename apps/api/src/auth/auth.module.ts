import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { ApiErrorFilter } from '../common/api-error.js';
import { ENV } from '../config/config.module.js';
import {
  ATTESTATION_VERIFIERS,
  AttestationService,
  createAttestationVerifiers,
} from '../devices/attestation/attestation.service.js';
import { DeviceRegistry } from '../devices/device-registry.js';
import { MeController } from '../users/me.controller.js';
import { WellKnownController } from '../well-known/well-known.controller.js';
import { AccessTokens } from './access-tokens.js';
import { AuthController } from './auth.controller.js';
import { ClientLimits } from './client-limits.js';
import { AuthGuard, SignatureGuard } from './guards.js';
import { LoginService } from './login.service.js';
import { OtpService } from './otp.service.js';
import { PasskeysService } from './passkeys.service.js';
import { RequestSignatures } from './request-signatures.js';
import { SessionsService } from './sessions.service.js';

@Module({
  controllers: [AuthController, MeController, WellKnownController],
  providers: [
    AccessTokens,
    ClientLimits,
    RequestSignatures,
    OtpService,
    SessionsService,
    PasskeysService,
    LoginService,
    DeviceRegistry,
    AttestationService,
    { provide: ATTESTATION_VERIFIERS, inject: [ENV], useFactory: createAttestationVerifiers },
    // Order matters: authentication first, then the device signature it makes possible.
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: SignatureGuard },
    { provide: APP_FILTER, useClass: ApiErrorFilter },
  ],
})
export class AuthModule {}
