import { HttpStatus, Injectable } from '@nestjs/common';
import { BarguCryptoError, verifyDeviceKeyBundle } from '@bargu/crypto';
import type { DeviceRegistration } from '@bargu/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { ApiError } from '../common/api-error.js';
import { isPgError, PG } from '../db/pg-errors.js';
import { devices, pushTokens, refreshTokens, securityEvents } from '../db/schema.js';
import type { Tx } from '../infra/database/database.service.js';
import type { AttestationKind } from './attestation/attestation.service.js';

export interface VerifiedDevice {
  deviceId: string;
  platform: DeviceRegistration['platform'];
  identityKey: Uint8Array;
  dhKey: Uint8Array;
  dhKeySignature: Uint8Array;
}

/** Checks a key bundle: valid identity key, DH key signed by it for this device id. */
export function verifyRegistration(registration: DeviceRegistration): VerifiedDevice {
  try {
    const keys = verifyDeviceKeyBundle(registration.bundle);
    return {
      deviceId: keys.deviceId,
      platform: registration.platform,
      identityKey: keys.identityKey,
      dhKey: keys.dhKey,
      dhKeySignature: new Uint8Array(Buffer.from(registration.bundle.dhKeySignature, 'base64url')),
    };
  } catch (error) {
    if (error instanceof BarguCryptoError) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'DEVICE_KEYS_INVALID');
    }
    throw error;
  }
}

const equal = (a: Uint8Array, b: Uint8Array) => Buffer.from(a).equals(Buffer.from(b));

/**
 * One active device per account (BARGU_PLAN §1, "tek aktif cihaz"), enforced in the same
 * transaction as the login: logging in on a new device revokes the previous one and every session
 * it had. The partial unique index in the database backs this up against races.
 */
@Injectable()
export class DeviceRegistry {
  /** Returns the id of the device this login replaced, if any. Runs inside `asUser(userId)`. */
  async activate(
    tx: Tx,
    userId: string,
    device: VerifiedDevice,
    attestation: AttestationKind | null,
  ): Promise<{ replacedDeviceId: string | null; newDevice: boolean }> {
    const now = new Date();
    const [existing] = await tx.select().from(devices).where(eq(devices.id, device.deviceId));
    if (existing !== undefined) {
      // A device id is bound to its keys forever, and a revoked device never comes back: the app
      // must create new keys (and a new id) after a logout or a remote revocation.
      if (existing.revokedAt !== null) throw new ApiError(HttpStatus.CONFLICT, 'DEVICE_REVOKED');
      if (
        !equal(existing.identityKey, device.identityKey) ||
        !equal(existing.dhKey, device.dhKey)
      ) {
        throw new ApiError(HttpStatus.CONFLICT, 'DEVICE_CONFLICT');
      }
      // Same device logging in again: earlier sessions of it end, the device stays.
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.deviceId, device.deviceId), isNull(refreshTokens.revokedAt)));
      return { replacedDeviceId: null, newDevice: false };
    }

    const [active] = await tx
      .select({ id: devices.id })
      .from(devices)
      .where(and(eq(devices.userId, userId), isNull(devices.revokedAt)))
      .for('update');
    if (active !== undefined) {
      await tx
        .update(devices)
        .set({ revokedAt: now, revokedReason: 'replaced' })
        .where(eq(devices.id, active.id));
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.deviceId, active.id), isNull(refreshTokens.revokedAt)));
      await tx
        .insert(securityEvents)
        .values({ userId, type: 'device_replaced', deviceId: device.deviceId });
      // The replaced phone gets no more notifications.
      await tx.delete(pushTokens).where(eq(pushTokens.deviceId, active.id));
    }

    try {
      await tx.insert(devices).values({
        id: device.deviceId,
        userId,
        platform: device.platform,
        identityKey: device.identityKey,
        dhKey: device.dhKey,
        dhKeySignature: device.dhKeySignature,
        attestation,
        attestedAt: attestation === null ? null : now,
      });
    } catch (error) {
      // The id or identity key already belongs to another account (invisible under RLS), or a
      // concurrent login of this account won the race for the single active slot.
      if (isUniqueViolation(error)) throw new ApiError(HttpStatus.CONFLICT, 'DEVICE_CONFLICT');
      throw error;
    }
    return { replacedDeviceId: active?.id ?? null, newDevice: true };
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return isPgError(error, PG.uniqueViolation);
}
