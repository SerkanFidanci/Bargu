import { HttpStatus, Injectable } from '@nestjs/common';
import type { DeviceRegistration, OtpVerify, PasskeyLoginVerify, Session } from '@bargu/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { securityEvents, users, type SecurityEventType } from '../db/schema.js';
import { AttestationService } from '../devices/attestation/attestation.service.js';
import {
  DeviceRegistry,
  isUniqueViolation,
  verifyRegistration,
  type VerifiedDevice,
} from '../devices/device-registry.js';
import { DatabaseService, type Tx } from '../infra/database/database.service.js';
import { OtpService } from './otp.service.js';
import { PasskeysService } from './passkeys.service.js';
import type { AuthedRequest } from './request-context.js';
import { RequestSignatures } from './request-signatures.js';
import { SessionsService } from './sessions.service.js';

/**
 * Login = proving the account (email code or passkey) + registering this device. Order: device
 * keys and their signature over the request first (no attempt is burnt for a bad device), then
 * platform attestation, then the account proof, then one transaction for account, device and
 * session.
 */
@Injectable()
export class LoginService {
  constructor(
    private readonly database: DatabaseService,
    private readonly signatures: RequestSignatures,
    private readonly attestation: AttestationService,
    private readonly registry: DeviceRegistry,
    private readonly otp: OtpService,
    private readonly passkeys: PasskeysService,
    private readonly sessions: SessionsService,
  ) {}

  async withOtp(body: OtpVerify, request: AuthedRequest): Promise<Session> {
    const { device, attested } = await this.checkDevice(body.device, request);
    const emailHmac = await this.otp.verify(body.challengeId, body.code, request.ip);
    const session = await this.loginByEmail(emailHmac, device, attested);
    await this.attestation.consume(body.device);
    return session;
  }

  async withPasskey(body: PasskeyLoginVerify, request: AuthedRequest): Promise<Session> {
    const { device, attested } = await this.checkDevice(body.device, request);
    const { userId, challenge } = await this.passkeys.takeLoginChallenge(body);
    const started = await this.database.asUser(userId, async (tx) => {
      const [user] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, userId), isNull(users.deletedAt)));
      if (user === undefined) throw new ApiError(HttpStatus.UNAUTHORIZED, 'PASSKEY_INVALID');
      await this.passkeys.verifyLogin(tx, body, challenge);
      return this.activate(tx, userId, device, attested, 'login_passkey', false);
    });
    await this.attestation.consume(body.device);
    return this.sessions.complete(started);
  }

  private async checkDevice(registration: DeviceRegistration, request: AuthedRequest) {
    const device = verifyRegistration(registration);
    await this.signatures.verify(request, device.deviceId, device.identityKey);
    const attested = await this.attestation.verify(registration, device.identityKey);
    return { device, attested };
  }

  private async loginByEmail(
    emailHmac: Uint8Array,
    device: VerifiedDevice,
    attested: Awaited<ReturnType<AttestationService['verify']>>,
  ): Promise<Session> {
    // Two attempts: a concurrent first login with the same address may create the account first.
    for (let attempt = 0; ; attempt++) {
      const existing = await this.database.userIdForEmail(emailHmac);
      const userId = existing ?? (await this.database.newId());
      try {
        const started = await this.database.asUser(userId, async (tx) => {
          if (existing === null) await tx.insert(users).values({ id: userId, emailHmac });
          return this.activate(tx, userId, device, attested, 'login_otp', existing === null);
        });
        return await this.sessions.complete(started);
      } catch (error) {
        if (existing === null && attempt === 0 && isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  private async activate(
    tx: Tx,
    userId: string,
    device: VerifiedDevice,
    attested: Awaited<ReturnType<AttestationService['verify']>>,
    event: SecurityEventType,
    isNewUser: boolean,
  ) {
    await this.registry.activate(tx, userId, device, attested);
    await tx.insert(securityEvents).values({ userId, type: event, deviceId: device.deviceId });
    return this.sessions.start(tx, userId, device.deviceId, isNewUser);
  }
}
