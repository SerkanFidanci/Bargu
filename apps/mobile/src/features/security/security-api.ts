import { type SecurityEvent, securityEventSchema, securityEventsSchema } from '@bargu/schemas';

import { api } from '../auth/auth-store';

/** Query key of the account's security events (read when the security screen opens). */
export const securityEventsKey = ['security-events'] as const;

/**
 * The account's security events (Faz 9), newest first. Each is checked on its own: a kind this
 * version does not know yet is left out rather than failing the list.
 */
export async function fetchSecurityEvents(): Promise<SecurityEvent[]> {
  const { events } = securityEventsSchema.parse(await api.authed('/v1/me/security-events'));
  return events.flatMap((raw) => {
    const parsed = securityEventSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}
