import { Injectable } from '@nestjs/common';
import { type SecurityEvent, SECURITY_EVENTS_DAYS, SECURITY_EVENTS_MAX } from '@bargu/schemas';
import { and, desc, eq, gt } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { devices, securityEvents } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';

const DAY_MS = 24 * 3600 * 1000;

/**
 * The account's security events (Faz 9, "güvenlik olayları"): sign-ins, a new phone replacing the
 * old one, a session ended for reuse, passkeys, sign-outs. Only the account's own (row-level
 * security), the last ${SECURITY_EVENTS_DAYS} days, with the kind of phone and whether it is the
 * caller's.
 */
@Injectable()
export class SecurityEventsService {
  constructor(private readonly database: DatabaseService) {}

  async list(auth: AuthContext): Promise<SecurityEvent[]> {
    const since = new Date(Date.now() - SECURITY_EVENTS_DAYS * DAY_MS);
    const rows = await this.database.asUser(auth.userId, (tx) =>
      tx
        .select({
          id: securityEvents.id,
          type: securityEvents.type,
          createdAt: securityEvents.createdAt,
          deviceId: securityEvents.deviceId,
          platform: devices.platform,
        })
        .from(securityEvents)
        .leftJoin(devices, eq(devices.id, securityEvents.deviceId))
        .where(and(eq(securityEvents.userId, auth.userId), gt(securityEvents.createdAt, since)))
        // Events of one transaction share a time; their ids (UUIDv7) keep the order they were written.
        .orderBy(desc(securityEvents.createdAt), desc(securityEvents.id))
        .limit(SECURITY_EVENTS_MAX),
    );
    return rows.map((row) => ({
      id: row.id,
      type: row.type,
      at: row.createdAt.getTime(),
      device:
        row.deviceId === null || row.platform === null
          ? null
          : { platform: row.platform, current: row.deviceId === auth.deviceId },
    }));
  }
}
