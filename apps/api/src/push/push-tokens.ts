import { Injectable } from '@nestjs/common';
import { openAtRest, sealAtRest } from '@bargu/crypto';
import type { PushRegistration } from '@bargu/schemas';
import { and, eq, isNull } from 'drizzle-orm';

import { AuthKeys } from '../auth/auth-keys.js';
import type { AuthContext } from '../auth/request-context.js';
import { devices, pushTokens } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';

const SEAL_CONTEXT = 'push/token';

export interface PushTarget {
  deviceId: string;
  token: string;
  locale: 'tr' | 'en';
}

/**
 * Each device's push token, sealed at rest with the server key (a dump or a log never shows it).
 * Only the user's current, active device is ever notified.
 */
@Injectable()
export class PushTokens {
  constructor(
    private readonly database: DatabaseService,
    private readonly keys: AuthKeys,
  ) {}

  async register(auth: AuthContext, input: PushRegistration): Promise<void> {
    const tokenSealed = sealAtRest(
      this.keys.jobPayloadKey,
      new TextEncoder().encode(input.token),
      SEAL_CONTEXT,
    );
    await this.database.asUser(auth.userId, (tx) =>
      tx
        .insert(pushTokens)
        .values({ deviceId: auth.deviceId, userId: auth.userId, tokenSealed, locale: input.locale })
        .onConflictDoUpdate({
          target: pushTokens.deviceId,
          set: { tokenSealed, locale: input.locale, updatedAt: new Date() },
        }),
    );
  }

  async remove(userId: string, deviceId: string): Promise<void> {
    await this.database.asUser(userId, (tx) =>
      tx.delete(pushTokens).where(eq(pushTokens.deviceId, deviceId)),
    );
  }

  /** Where to notify a user: their active device, if it registered for notifications. */
  async targetOf(userId: string): Promise<PushTarget | null> {
    const [row] = await this.database.asUser(userId, (tx) =>
      tx
        .select({
          deviceId: pushTokens.deviceId,
          tokenSealed: pushTokens.tokenSealed,
          locale: pushTokens.locale,
        })
        .from(pushTokens)
        .innerJoin(devices, eq(devices.id, pushTokens.deviceId))
        .where(and(eq(pushTokens.userId, userId), isNull(devices.revokedAt)))
        .limit(1),
    );
    if (row === undefined) return null;
    const token = new TextDecoder().decode(
      openAtRest(this.keys.jobPayloadKey, row.tokenSealed, SEAL_CONTEXT),
    );
    return { deviceId: row.deviceId, token, locale: row.locale };
  }
}
