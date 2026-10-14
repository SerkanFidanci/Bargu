import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export const serviceAccountSchema = z.object({
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
  project_id: z.string().min(1).optional(),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

/** A Google service account key file, given base64-encoded in the environment. */
export function parseServiceAccount(base64: string): ServiceAccount {
  return serviceAccountSchema.parse(JSON.parse(Buffer.from(base64, 'base64').toString('utf8')));
}

/**
 * OAuth 2.0 access tokens for a service account (JWT bearer grant, RFC 7523), one scope, cached
 * until a minute before they expire. The private key never leaves this process.
 */
export class GoogleAccessTokens {
  private cached: { value: string; expiresAt: number } | undefined;

  constructor(
    private readonly account: ServiceAccount,
    private readonly scope: string,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    const now = this.now();
    if (this.cached !== undefined && this.cached.expiresAt - 60_000 > now) {
      return this.cached.value;
    }
    const issuedAt = Math.floor(now / 1000);
    const assertion = await new SignJWT({ scope: this.scope })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await importPKCS8(this.account.private_key, 'RS256'));
    const response = await this.fetchImpl(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }).toString(),
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('Google token request failed');
    const body = z
      .object({ access_token: z.string(), expires_in: z.number() })
      .parse(await response.json());
    this.cached = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }

  /** The service refused the token (revoked, rotated): fetch a new one next time. */
  invalidate(): void {
    this.cached = undefined;
  }
}
