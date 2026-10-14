import { z } from 'zod';

import { GoogleAccessTokens, type ServiceAccount } from '../infra/google/service-account.js';

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

export interface PushMessage {
  token: string;
  /** The sealed notification (docs/PROTOCOL.md §7): the app opens it and words it itself. */
  sealed: string;
}

/** `sent`; `unregistered`: the token is dead (app removed, data cleared), forget it. */
export type SendResult = 'sent' | 'unregistered';

/** FCM refused the message for good (malformed): retrying will not help. */
export class FcmRejected extends Error {
  override readonly name = 'FcmRejected';
}

const errorSchema = z.object({
  error: z.object({
    details: z.array(z.object({ errorCode: z.string().optional() }).loose()).optional(),
  }),
});

/**
 * Firebase Cloud Messaging HTTP v1, called directly with our own service account (no third-party
 * push relay). Data-only and high priority (docs/ADR/0016): the app wakes, opens the sealed box and
 * shows the notification itself, so Google carries ciphertext and never a text. The key is not
 * "title", "body" or "message": expo-notifications would display those as they are.
 */
export class FcmClient {
  private readonly tokens: GoogleAccessTokens;

  constructor(
    private readonly account: ServiceAccount & { project_id: string },
    private readonly fetchImpl: typeof fetch = fetch,
    now: () => number = Date.now,
  ) {
    this.tokens = new GoogleAccessTokens(account, SCOPE, fetchImpl, now);
  }

  async send(message: PushMessage): Promise<SendResult> {
    const response = await this.fetchImpl(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.account.project_id)}/messages:send`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${await this.tokens.get()}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          message: {
            token: message.token,
            data: { bargu: message.sealed },
            // Older than an hour is better told by the app itself when it opens.
            android: { priority: 'HIGH', ttl: '3600s' },
          },
        }),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.ok) return 'sent';
    const parsed = errorSchema.safeParse(await response.json().catch(() => ({})));
    const codes = parsed.success
      ? (parsed.data.error.details ?? []).map((detail) => detail.errorCode)
      : [];
    if (response.status === 404 || codes.includes('UNREGISTERED')) return 'unregistered';
    if (response.status === 401) this.tokens.invalidate();
    if (response.status === 400) throw new FcmRejected(codes.join(',') || 'INVALID_ARGUMENT');
    // 401, 403, 429, 5xx: worth another try later (the queue retries with backoff).
    throw new Error(`FCM ${String(response.status)}`);
  }
}
