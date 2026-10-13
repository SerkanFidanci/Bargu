import { Body, Controller, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import {
  otpRequestSchema,
  otpVerifySchema,
  passkeyLoginVerifySchema,
  passkeyRegisterVerifySchema,
  refreshRequestSchema,
  type AttestationChallenge,
  type OtpChallenge,
  type OtpRequest,
  type OtpVerify,
  type PasskeyLoginVerify,
  type PasskeyRegisterVerify,
  type RefreshRequest,
  type Session,
} from '@bargu/schemas';

import { ZodPipe } from '../common/zod.pipe.js';
import { AttestationService } from '../devices/attestation/attestation.service.js';
import { ClientLimits } from './client-limits.js';
import { LoginService } from './login.service.js';
import { OtpService } from './otp.service.js';
import { PasskeysService } from './passkeys.service.js';
import {
  type AuthContext,
  type AuthedRequest,
  CurrentAuth,
  Public,
  SignedInHandler,
  Unsigned,
} from './request-context.js';
import { SessionsService } from './sessions.service.js';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly otp: OtpService,
    private readonly login: LoginService,
    private readonly sessions: SessionsService,
    private readonly passkeys: PasskeysService,
    private readonly attestation: AttestationService,
    private readonly clients: ClientLimits,
  ) {}

  /** Sends a login code. Same response whether or not the address has an account. */
  @Post('otp/request')
  @Public()
  @Unsigned()
  @HttpCode(HttpStatus.ACCEPTED)
  requestOtp(
    @Body(new ZodPipe(otpRequestSchema)) body: OtpRequest,
    @Req() request: AuthedRequest,
  ): Promise<OtpChallenge> {
    return this.otp.request(body, request.ip);
  }

  /** Code + new device keys (signed by them) → account, device and session. */
  @Post('otp/verify')
  @Public()
  @SignedInHandler()
  @HttpCode(HttpStatus.OK)
  verifyOtp(
    @Body(new ZodPipe(otpVerifySchema)) body: OtpVerify,
    @Req() request: AuthedRequest,
  ): Promise<Session> {
    return this.login.withOtp(body, request);
  }

  /** Fresh challenge for App Attest / Play Integrity, bound to the device key at login. */
  @Post('attestation/challenge')
  @Public()
  @Unsigned()
  @HttpCode(HttpStatus.OK)
  async attestationChallenge(@Req() request: AuthedRequest): Promise<AttestationChallenge> {
    await this.clients.enforce('attestationChallenge', request.ip);
    return this.attestation.createChallenge();
  }

  @Post('passkey/options')
  @Public()
  @Unsigned()
  @HttpCode(HttpStatus.OK)
  async passkeyOptions(@Req() request: AuthedRequest) {
    await this.clients.enforce('passkeyOptions', request.ip);
    return this.passkeys.loginOptions();
  }

  @Post('passkey/verify')
  @Public()
  @SignedInHandler()
  @HttpCode(HttpStatus.OK)
  verifyPasskey(
    @Body(new ZodPipe(passkeyLoginVerifySchema)) body: PasskeyLoginVerify,
    @Req() request: AuthedRequest,
  ): Promise<Session> {
    return this.login.withPasskey(body, request);
  }

  @Post('passkey/register/options')
  @HttpCode(HttpStatus.OK)
  passkeyRegistrationOptions(@CurrentAuth() auth: AuthContext) {
    return this.passkeys.registrationOptions(auth);
  }

  @Post('passkey/register')
  @HttpCode(HttpStatus.NO_CONTENT)
  registerPasskey(
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodPipe(passkeyRegisterVerifySchema)) body: PasskeyRegisterVerify,
  ): Promise<void> {
    return this.passkeys.register(auth, body);
  }

  /** Rotates the refresh token; signed by the device the token belongs to. */
  @Post('refresh')
  @Public()
  @SignedInHandler()
  @HttpCode(HttpStatus.OK)
  refresh(
    @Body(new ZodPipe(refreshRequestSchema)) body: RefreshRequest,
    @Req() request: AuthedRequest,
  ): Promise<Session> {
    return this.sessions.refresh(body.refreshToken, request);
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  logout(@CurrentAuth() auth: AuthContext): Promise<void> {
    return this.sessions.logout(auth);
  }
}
