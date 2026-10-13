import { Controller, Get } from '@nestjs/common';
import type { Me } from '@bargu/schemas';
import { count, eq } from 'drizzle-orm';

import { type AuthContext, CurrentAuth } from '../auth/request-context.js';
import { devices, passkeys, users } from '../db/schema.js';
import { DatabaseService } from '../infra/database/database.service.js';

@Controller('v1/me')
export class MeController {
  constructor(private readonly database: DatabaseService) {}

  /** The signed-in account and device. Row-level security scopes every query to the caller. */
  @Get()
  me(@CurrentAuth() auth: AuthContext): Promise<Me> {
    return this.database.asUser(auth.userId, async (tx) => {
      const [user] = await tx
        .select({ username: users.username, displayName: users.displayName })
        .from(users);
      const [device] = await tx
        .select({ platform: devices.platform, attestedAt: devices.attestedAt })
        .from(devices)
        .where(eq(devices.id, auth.deviceId));
      const [keys] = await tx.select({ total: count() }).from(passkeys);
      return {
        userId: auth.userId,
        username: user?.username ?? null,
        displayName: user?.displayName ?? null,
        device: {
          id: auth.deviceId,
          platform: device?.platform ?? 'android',
          attested: device?.attestedAt !== null && device?.attestedAt !== undefined,
        },
        passkeys: keys?.total ?? 0,
      };
    });
  }
}
