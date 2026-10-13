import { HttpStatus, Injectable } from '@nestjs/common';
import { verifySenderKeyDistribution } from '@bargu/crypto';
import {
  type KeyUpload,
  senderKeyDistributionSchema,
  type SenderKeyDistribution,
} from '@bargu/schemas';
import { and, eq, gte, sql } from 'drizzle-orm';

import type { AuthContext } from '../auth/request-context.js';
import { ApiError } from '../common/api-error.js';
import { keyEnvelopes } from '../db/schema.js';
import { EventsService } from '../events/events.service.js';
import { DatabaseService } from '../infra/database/database.service.js';
import { RateLimiter } from '../infra/redis/rate-limiter.js';
import { CirclesService } from './circles.service.js';

/** The protocol accepts the current epoch and the two before it (PROTOCOL §5, epoch floor). */
export const RETAINED_EPOCHS = 2;
export const KEY_LIMITS = { uploadsPerHour: 240 } as const;

const HOUR = 3600;

/**
 * Sender-key distributions (PROTOCOL §4). The server cannot read them; it checks that each one is
 * signed by the uploading device, is for the circle's current epoch, and goes to the active device
 * of another active member, then stores it for that device and tells its owner.
 */
@Injectable()
export class KeysService {
  constructor(
    private readonly database: DatabaseService,
    private readonly circles: CirclesService,
    private readonly events: EventsService,
    private readonly limiter: RateLimiter,
  ) {}

  async upload(auth: AuthContext, circleId: string, upload: KeyUpload): Promise<void> {
    const allowed = await this.limiter.hit(`keys:${auth.userId}`, KEY_LIMITS.uploadsPerHour, HOUR);
    if (!allowed.allowed) {
      throw new ApiError(HttpStatus.TOO_MANY_REQUESTS, 'RATE_LIMITED', allowed.retryAfter);
    }
    const recipients = await this.database.asUser(auth.userId, async (tx) => {
      const circle = await this.circles.mustRead(tx, circleId, auth.userId);
      if (circle.myStatus !== 'active') throw new ApiError(HttpStatus.NOT_FOUND, 'NOT_FOUND');
      if (upload.epoch !== circle.epoch) throw new ApiError(HttpStatus.CONFLICT, 'EPOCH_STALE');
      const owners = new Map<string, string>();
      for (const member of circle.members) {
        if (member.status === 'active' && member.device !== null && member.userId !== auth.userId) {
          owners.set(member.device.bundle.deviceId, member.userId);
        }
      }
      const seen = new Set<string>();
      const rows = upload.distributions.map((distribution) => {
        const recipientUserId = owners.get(distribution.recipientDeviceId);
        if (
          recipientUserId === undefined ||
          seen.has(distribution.recipientDeviceId) ||
          distribution.circleId !== circleId ||
          distribution.epoch !== circle.epoch ||
          distribution.senderDeviceId !== auth.deviceId ||
          !verifySenderKeyDistribution(distribution, auth.identityKey)
        ) {
          throw new ApiError(HttpStatus.BAD_REQUEST, 'KEYS_INVALID');
        }
        seen.add(distribution.recipientDeviceId);
        return {
          circleId,
          epoch: circle.epoch,
          senderDeviceId: auth.deviceId,
          recipientDeviceId: distribution.recipientDeviceId,
          senderUserId: auth.userId,
          recipientUserId,
          envelope: distribution,
        };
      });
      await tx
        .insert(keyEnvelopes)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            keyEnvelopes.circleId,
            keyEnvelopes.epoch,
            keyEnvelopes.senderDeviceId,
            keyEnvelopes.recipientDeviceId,
          ],
          set: { envelope: sql`excluded.envelope`, createdAt: sql`now()` },
        });
      return { userIds: rows.map((row) => row.recipientUserId), epoch: circle.epoch };
    });
    await this.events.publish(recipients.userIds, {
      type: 'keys.available',
      circleId,
      epoch: recipients.epoch,
    });
  }

  /** The distributions addressed to this device, for the epochs still accepted. */
  async list(auth: AuthContext, circleId: string): Promise<SenderKeyDistribution[]> {
    return this.database.asUser(auth.userId, async (tx) => {
      const circle = await this.circles.mustRead(tx, circleId, auth.userId);
      const rows = await tx
        .select({ envelope: keyEnvelopes.envelope })
        .from(keyEnvelopes)
        .where(
          and(
            eq(keyEnvelopes.circleId, circleId),
            eq(keyEnvelopes.recipientDeviceId, auth.deviceId),
            gte(keyEnvelopes.epoch, circle.epoch - RETAINED_EPOCHS),
          ),
        );
      // Stored only after validation; parsed again so nothing unexpected leaves the server.
      return rows.flatMap((row) => {
        const parsed = senderKeyDistributionSchema.safeParse(row.envelope);
        return parsed.success ? [parsed.data] : [];
      });
    });
  }
}
