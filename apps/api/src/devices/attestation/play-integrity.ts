import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/playintegrity';
/** A verdict older than this is not accepted (Google recommends a short window). */
const MAX_VERDICT_AGE_MS = 5 * 60 * 1000;

const serviceAccountSchema = z.object({
  client_email: z.email(),
  private_key: z.string().includes('PRIVATE KEY'),
});

const verdictSchema = z.object({
  tokenPayloadExternal: z.object({
    requestDetails: z.object({
      requestPackageName: z.string(),
      requestHash: z.string(),
      timestampMillis: z.coerce.number(),
    }),
    appIntegrity: z.object({
      appRecognitionVerdict: z.string(),
      packageName: z.string().optional(),
      certificateSha256Digest: z.array(z.string()).optional(),
    }),
    deviceIntegrity: z.object({ deviceRecognitionVerdict: z.array(z.string()).optional() }),
  }),
});

export interface PlayIntegrityConfig {
  packageName: string;
  /** Upper-case `AA:BB:…` SHA-256 fingerprints of the app signing certificates. */
  certificateFingerprints: readonly string[];
  /** Service account JSON, base64. */
  serviceAccount: string;
  fetch?: typeof fetch;
  now?: () => number;
}

const fingerprintToBase64url = (fingerprint: string) =>
  Buffer.from(fingerprint.replaceAll(':', ''), 'hex').toString('base64url');

/**
 * Play Integrity standard request, decoded server-side by Google (the app never sees the verdict
 * key). Accepts only: our package, the expected request hash, a fresh verdict, a Play-recognised
 * build signed with our certificate, on a device that meets device integrity.
 */
export class PlayIntegrityVerifier {
  private readonly account: z.infer<typeof serviceAccountSchema>;
  private readonly fetch: typeof fetch;
  private readonly now: () => number;
  private accessToken: { value: string; expiresAt: number } | undefined;

  constructor(private readonly config: PlayIntegrityConfig) {
    this.account = serviceAccountSchema.parse(
      JSON.parse(Buffer.from(config.serviceAccount, 'base64').toString('utf8')),
    );
    this.fetch = config.fetch ?? fetch;
    this.now = config.now ?? Date.now;
  }

  async verify(token: string, expectedRequestHash: string): Promise<boolean> {
    let verdict: z.infer<typeof verdictSchema>;
    try {
      const response = await this.fetch(
        `https://playintegrity.googleapis.com/v1/${encodeURIComponent(this.config.packageName)}:decodeIntegrityToken`,
        {
          method: 'POST',
          headers: {
            authorization: `Bearer ${await this.googleAccessToken()}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ integrity_token: token }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (!response.ok) return false;
      verdict = verdictSchema.parse(await response.json());
    } catch {
      return false;
    }

    const { requestDetails, appIntegrity, deviceIntegrity } = verdict.tokenPayloadExternal;
    const allowed = new Set(this.config.certificateFingerprints.map(fingerprintToBase64url));
    const age = this.now() - requestDetails.timestampMillis;
    return (
      requestDetails.requestPackageName === this.config.packageName &&
      requestDetails.requestHash === expectedRequestHash &&
      age >= -60_000 &&
      age <= MAX_VERDICT_AGE_MS &&
      appIntegrity.appRecognitionVerdict === 'PLAY_RECOGNIZED' &&
      appIntegrity.packageName === this.config.packageName &&
      (appIntegrity.certificateSha256Digest ?? []).some((digest) =>
        allowed.has(digest.replace(/=+$/, '').replaceAll('+', '-').replaceAll('/', '_')),
      ) &&
      (deviceIntegrity.deviceRecognitionVerdict ?? []).includes('MEETS_DEVICE_INTEGRITY')
    );
  }

  /** OAuth 2.0 JWT bearer grant (RFC 7523) for the service account, cached until near expiry. */
  private async googleAccessToken(): Promise<string> {
    const now = this.now();
    if (this.accessToken !== undefined && this.accessToken.expiresAt - 60_000 > now) {
      return this.accessToken.value;
    }
    const issuedAt = Math.floor(now / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await importPKCS8(this.account.private_key, 'RS256'));
    const response = await this.fetch(TOKEN_URL, {
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
    this.accessToken = { value: body.access_token, expiresAt: now + body.expires_in * 1000 };
    return body.access_token;
  }
}
